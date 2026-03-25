/**
 * Proactive Photo Search Service V7.2
 * 
 * Pipeline de recherche proactive basé sur les visages détectés:
 * 1. Correspondance avec les personnes connues (base de données locale)
 * 2. Si correspondance trouvée: enrichissement via MARS v2
 * 3. Options de suivi: sauvegarder, créer contact, recherche approfondie
 * 
 * IMPORTANT: Ce service ne fabrique JAMAIS de profils fictifs.
 * Si aucune correspondance n'est trouvée, il le dit clairement.
 * Conformité RGPD: uniquement données publiques + base locale.
 */

import { matchFaceMultiple, getPersons } from "./faceRecognitionService";
import { searchWithMARS } from "./marsService";
import { memoryService } from "./memory";
import { db } from "../db";
import { knownPersons } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface PhotoSearchInput {
  imageDataUrl?: string;
  faceDescriptor?: number[];
  userContext?: string;
}

export interface KnownPersonMatch {
  personId: number;
  name: string;
  confidence: number;
  matchType: "exact" | "high" | "medium" | "low";
  photoCount: number;
  notes?: string | null;
}

export interface PhotoSearchResult {
  success: boolean;
  hasMatches: boolean;
  knownPersonMatches: KnownPersonMatch[];
  enrichedInfo?: {
    publicInfo: string;
    sources: string[];
    reliabilityScore: number;
  };
  memoryId?: string;
  options: {
    code: string;
    label: string;
    description: string;
  }[];
  message: string;
}

class ProactivePhotoSearchService {
  
  /**
   * Pipeline principal de recherche photo proactive
   * Prend un descripteur facial (128-dim) extrait côté client
   */
  async searchFromDescriptor(
    userId: number,
    descriptor: number[],
    context?: string
  ): Promise<PhotoSearchResult> {
    console.log("[ProactivePhotoSearch] Starting pipeline with facial descriptor");
    
    // Vérification que le descripteur est valide
    if (!descriptor || descriptor.length !== 128) {
      return {
        success: false,
        hasMatches: false,
        knownPersonMatches: [],
        options: [],
        message: "Descripteur facial invalide. Veuillez réessayer avec une photo plus nette."
      };
    }
    
    // Étape 1: Correspondance avec les personnes connues
    const matches = await this.matchWithKnownPersons(userId, descriptor);
    console.log("[ProactivePhotoSearch] Found", matches.length, "matches in known persons");
    
    if (matches.length === 0) {
      // Aucune correspondance trouvée - retour honnête
      return {
        success: true,
        hasMatches: false,
        knownPersonMatches: [],
        options: [
          {
            code: "A",
            label: "Enregistrer ce visage",
            description: "Ajouter cette personne à ma liste de contacts connus"
          },
          {
            code: "B",
            label: "Annuler",
            description: "Ne rien faire"
          }
        ],
        message: "Je ne reconnais pas cette personne dans ta liste de contacts connus. Veux-tu l'ajouter?"
      };
    }
    
    // Étape 2: Enrichissement pour le meilleur match
    const topMatch = matches[0];
    let enrichedInfo;
    
    if (topMatch.confidence >= 0.7) {
      enrichedInfo = await this.enrichWithPublicInfo(userId, topMatch.name);
    }
    
    // Étape 3: Sauvegarde en mémoire si pertinent
    let memoryId: string | undefined;
    if (context && topMatch.confidence >= 0.6) {
      memoryId = await this.saveSearchToMemory(userId, topMatch, context);
    }
    
    // Étape 4: Génération des options
    const options = this.generateOptions(matches, enrichedInfo);
    
    console.log("[ProactivePhotoSearch] Pipeline complete");
    
    return {
      success: true,
      hasMatches: true,
      knownPersonMatches: matches,
      enrichedInfo,
      memoryId,
      options,
      message: this.formatMatchMessage(matches, enrichedInfo)
    };
  }
  
  /**
   * Recherche par photo uploadée (sans descripteur préextrait)
   * Retourne un message indiquant que l'extraction doit être faite côté client
   */
  async searchFromPhoto(
    photoPath: string,
    userId: number,
    context?: string
  ): Promise<PhotoSearchResult> {
    console.log("[ProactivePhotoSearch] Photo upload detected:", photoPath);
    
    // Vérifier si l'utilisateur a des personnes connues enregistrées
    const knownCount = await this.countKnownPersons(userId);
    
    if (knownCount === 0) {
      return {
        success: true,
        hasMatches: false,
        knownPersonMatches: [],
        options: [
          {
            code: "A",
            label: "Configurer la reconnaissance faciale",
            description: "Enregistrer des visages pour pouvoir les reconnaître"
          }
        ],
        message: "Tu n'as pas encore de personnes enregistrées. Pour identifier quelqu'un sur une photo, tu dois d'abord enregistrer des visages connus."
      };
    }
    
    // L'extraction de descripteurs nécessite le traitement côté client (face-api.js)
    return {
      success: true,
      hasMatches: false,
      knownPersonMatches: [],
      options: [
        {
          code: "DETECT",
          label: "Analyser le visage",
          description: "Utilise le bouton d'analyse faciale dans l'interface pour identifier cette personne"
        }
      ],
      message: `Tu as ${knownCount} personne(s) enregistrée(s). Pour identifier le visage sur cette photo, utilise le bouton d'analyse faciale dans l'interface de la bibliothèque média.`
    };
  }
  
  /**
   * Correspondance avec les personnes connues de l'utilisateur
   */
  private async matchWithKnownPersons(
    userId: number,
    descriptor: number[]
  ): Promise<KnownPersonMatch[]> {
    try {
      const faceMatches = await matchFaceMultiple(userId, descriptor, 3);
      
      if (!faceMatches || faceMatches.length === 0) {
        return [];
      }
      
      // Enrichir avec les infos complètes des personnes
      const enrichedMatches: KnownPersonMatch[] = [];
      
      for (const match of faceMatches) {
        const [person] = await db.select()
          .from(knownPersons)
          .where(and(
            eq(knownPersons.id, match.personId),
            eq(knownPersons.userId, userId)
          ));
        
        if (person) {
          enrichedMatches.push({
            personId: match.personId,
            name: match.personName,
            confidence: match.confidence,
            matchType: match.matchType,
            photoCount: match.descriptorCount,
            notes: person.notes
          });
        }
      }
      
      return enrichedMatches;
    } catch (error) {
      console.error("[ProactivePhotoSearch] Match error:", error);
      return [];
    }
  }
  
  /**
   * Compter les personnes connues de l'utilisateur
   */
  private async countKnownPersons(userId: number): Promise<number> {
    try {
      const persons = await getPersons(userId);
      return persons.length;
    } catch (error) {
      return 0;
    }
  }
  
  /**
   * Enrichir avec des infos publiques via MARS (optionnel)
   * Uniquement si le nom est assez unique pour une recherche pertinente
   */
  private async enrichWithPublicInfo(
    userId: number,
    personName: string
  ): Promise<{ publicInfo: string; sources: string[]; reliabilityScore: number } | undefined> {
    // Pas d'enrichissement pour les prénoms seuls (trop vague)
    if (!personName.includes(" ") || personName.length < 5) {
      return undefined;
    }
    
    try {
      const marsResult = await searchWithMARS(
        userId,
        `${personName} profil professionnel`,
        { maxResults: 3 }
      );
      
      if (marsResult.success && marsResult.orchestratorResponse.results.length > 0) {
        const relevantResults = marsResult.orchestratorResponse.results
          .filter(r => r.reliability && r.reliability > 60);
        
        if (relevantResults.length > 0) {
          return {
            publicInfo: relevantResults.map(r => r.snippet).join(" "),
            sources: relevantResults.map(r => r.source || r.url).slice(0, 3),
            reliabilityScore: marsResult.orchestratorResponse.averageReliability || 0
          };
        }
      }
    } catch (error) {
      console.log("[ProactivePhotoSearch] MARS enrichment skipped:", error);
    }
    
    return undefined;
  }
  
  /**
   * Sauvegarder la recherche en mémoire
   */
  private async saveSearchToMemory(
    userId: number,
    match: KnownPersonMatch,
    context: string
  ): Promise<string> {
    const memoryId = `photo_search_${Date.now()}`;
    
    try {
      await memoryService.saveToMemory(userId, {
        type: "recognition",
        category: "photo_search",
        content: `Reconnaissance faciale: ${match.name} (confiance ${Math.round(match.confidence * 100)}%)`,
        context: context,
        metadata: {
          personId: match.personId,
          confidence: match.confidence,
          matchType: match.matchType
        },
        isOwner: true
      });
    } catch (error) {
      console.error("[ProactivePhotoSearch] Memory save error:", error);
    }
    
    return memoryId;
  }
  
  /**
   * Générer les options de suivi
   */
  private generateOptions(
    matches: KnownPersonMatch[],
    enrichedInfo?: { publicInfo: string; sources: string[]; reliabilityScore: number }
  ): PhotoSearchResult["options"] {
    const options: PhotoSearchResult["options"] = [];
    
    if (matches.length > 0) {
      options.push({
        code: "A",
        label: "Voir le profil complet",
        description: `Afficher toutes les infos sur ${matches[0].name}`
      });
      
      if (enrichedInfo) {
        options.push({
          code: "B",
          label: "Sources en ligne",
          description: "Voir les résultats de recherche web"
        });
      }
      
      options.push({
        code: "C",
        label: "Créer un rappel",
        description: `Ajouter une note pour ${matches[0].name}`
      });
    }
    
    options.push({
      code: "D",
      label: "Annuler",
      description: "Fermer"
    });
    
    return options;
  }
  
  /**
   * Formater le message de résultat
   */
  private formatMatchMessage(
    matches: KnownPersonMatch[],
    enrichedInfo?: { publicInfo: string; sources: string[]; reliabilityScore: number }
  ): string {
    if (matches.length === 0) {
      return "Je ne reconnais pas cette personne.";
    }
    
    const top = matches[0];
    const confidenceText = top.confidence >= 0.8 ? "Je suis sûr" :
                          top.confidence >= 0.6 ? "Je pense" : "Il me semble";
    
    let message = `${confidenceText} que c'est ${top.name}`;
    
    if (top.matchType === "exact") {
      message += " (correspondance exacte)";
    }
    
    if (top.notes) {
      message += `. Note: ${top.notes}`;
    }
    
    if (matches.length > 1) {
      const others = matches.slice(1).map(m => m.name).join(" ou ");
      message += `. Pourrait aussi être: ${others}.`;
    }
    
    return message;
  }
  
  /**
   * Formater pour affichage dans le chat
   */
  formatForChat(result: PhotoSearchResult): string {
    let output = result.message;
    
    if (result.options.length > 0) {
      output += "\n\n**Options:**";
      for (const opt of result.options) {
        output += `\n- **${opt.code}**: ${opt.label}`;
      }
    }
    
    return output;
  }
}

export const proactivePhotoSearchService = new ProactivePhotoSearchService();
