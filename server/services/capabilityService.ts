import { db } from "../db";
import { capabilityRegistry, capabilityChangelog, actionLogs } from "@shared/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { ULYSSE_CAPABILITIES, CAPABILITIES_VERSION, CAPABILITIES_LAST_UPDATE, Capability } from "../config/ulysseCapabilities";
import { agentMailService } from "./agentMailService";
import { calendarService } from "./googleCalendarService";
import { checkDriveConnection } from "./googleDriveService";
import { checkNotionConnection } from "./notionService";
import { checkTodoistConnection } from "./todoistService";
import { withRetry, isRetryableError } from "../utils/retryHelper";
import { dependencyCircuitBreakers } from "./circuitBreakerManager";

interface CapabilityStatus {
  id: number;
  name: string;
  category: string;
  isAvailable: boolean;
  successRate: number;
  lastUsed: Date | null;
  failureReason: string | null;
}

interface CapabilityRuntimeSnapshot {
  version: string;
  lastUpdate: string;
  totalCapabilities: number;
  availableCount: number;
  unavailableCount: number;
  capabilities: CapabilityStatus[];
  recentIssues: string[];
}

interface DependencyProbe {
  name: string;
  check: () => Promise<boolean>;
  errorMessage: string;
}

const DEPENDENCY_PROBES: DependencyProbe[] = [
  {
    name: "database",
    check: async () => {
      try {
        await db.execute(sql`SELECT 1`);
        return true;
      } catch { return false; }
    },
    errorMessage: "Database connection failed"
  },
  {
    name: "openai",
    check: async () => !!(process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
    errorMessage: "OpenAI API key not configured"
  },
  {
    name: "googleImages",
    check: async () => !!process.env.GOOGLE_API_KEY && !!process.env.GOOGLE_SEARCH_ENGINE_ID,
    errorMessage: "Google Custom Search API not configured"
  },
  {
    name: "agentmail",
    check: async () => {
      try {
        const connected = await agentMailService.isConnected();
        console.log("[CapabilityService] AgentMail connection check:", connected);
        return connected;
      } catch (error) {
        console.log("[CapabilityService] AgentMail connection check failed:", error);
        return false;
      }
    },
    errorMessage: "AgentMail not connected"
  },
  {
    name: "objectStorage",
    check: async () => !!(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || process.env.LOCAL_STORAGE_PATH),
    errorMessage: "Object Storage not configured"
  },
  {
    name: "gmail",
    check: async () => {
      try {
        const { googleMailService } = await import('./googleMailService');
        const connected = await googleMailService.isConnected();
        console.log("[CapabilityService] Gmail connection check:", connected);
        return connected;
      } catch (error) {
        console.log("[CapabilityService] Gmail connection check failed:", error);
        return false;
      }
    },
    errorMessage: "Gmail not connected"
  },
  {
    name: "googleCalendar",
    check: async () => {
      try {
        const connected = await calendarService.isConnected();
        console.log("[CapabilityService] Google Calendar connection check:", connected);
        return connected;
      } catch (error) {
        console.log("[CapabilityService] Google Calendar connection check failed:", error);
        return false;
      }
    },
    errorMessage: "Google Calendar not connected"
  },
  {
    name: "googleDrive",
    check: async () => {
      try {
        const connected = await checkDriveConnection();
        console.log("[CapabilityService] Google Drive connection check:", connected);
        return connected;
      } catch (error) {
        console.log("[CapabilityService] Google Drive connection check failed:", error);
        return false;
      }
    },
    errorMessage: "Google Drive not connected"
  },
  {
    name: "notion",
    check: async () => {
      try {
        const connected = await checkNotionConnection();
        console.log("[CapabilityService] Notion connection check:", connected);
        return connected;
      } catch (error) {
        console.log("[CapabilityService] Notion connection check failed:", error);
        return false;
      }
    },
    errorMessage: "Notion not connected"
  },
  {
    name: "todoist",
    check: async () => {
      try {
        const connected = await checkTodoistConnection();
        console.log("[CapabilityService] Todoist connection check:", connected);
        return connected;
      } catch (error) {
        console.log("[CapabilityService] Todoist connection check failed:", error);
        return false;
      }
    },
    errorMessage: "Todoist not connected"
  }
];

const CAPABILITY_DEPENDENCIES: Record<string, string[]> = {
  "Envoyer un Email": ["agentmail"],
  "Envoyer Email avec PDF": ["agentmail", "objectStorage"],
  "Envoyer Email avec Word": ["agentmail", "objectStorage"],
  "Lire les Emails": ["agentmail"],
  "Recherche Web": ["openai"],
  "Lecture de Sites Web": ["openai"],
  "Lire les Événements": ["googleCalendar"],
  "Créer un Événement": ["googleCalendar"],
  "Génération d'Images": ["openai"],
  "Recherche Images Google": ["googleImages"],
  "Stockage Permanent": ["objectStorage", "database"],
  "Mémoire Permanente": ["database"],
  "Base de Données PostgreSQL": ["database"],
  "Google Drive - Lister Fichiers": ["googleDrive"],
  "Google Drive - Rechercher Fichiers": ["googleDrive"],
  "Google Drive - Créer Dossier": ["googleDrive"],
  "Google Drive - Créer Document": ["googleDrive"],
  "Google Drive - Créer Feuille": ["googleDrive"],
  "Notion - Rechercher": ["notion"],
  "Notion - Lister Bases": ["notion"],
  "Notion - Créer Page": ["notion"],
  "Notion - Lire Page": ["notion"],
  "Todoist - Lister Tâches": ["todoist"],
  "Todoist - Créer Tâche": ["todoist"],
  "Todoist - Compléter Tâche": ["todoist"],
  "Todoist - Lister Projets": ["todoist"]
};

class CapabilityService {
  private dependencyStatus: Map<string, boolean> = new Map();
  private lastProbeTime: Date | null = null;
  private probeIntervalMs = 5 * 60 * 1000;

  async initialize(): Promise<void> {
    console.log("[CapabilityService] Initializing...");
    await this.syncCapabilitiesToDatabase();
    await this.probeDependencies();
    console.log("[CapabilityService] Initialized with", ULYSSE_CAPABILITIES.length, "capabilities");
  }

  // AMÉLIORATION: Batch upsert au lieu de N requêtes séquentielles (proposition Ulysse)
  async syncCapabilitiesToDatabase(): Promise<void> {
    const startTime = Date.now();
    
    // 1. Récupérer toutes les capacités existantes en une seule requête
    const existing = await db.select().from(capabilityRegistry);
    const existingMap = new Map(existing.map(c => [c.name, c]));
    
    // 2. Préparer les insertions et mises à jour
    const toInsert: Array<{
      category: string;
      name: string;
      description: string;
      marker: string | null;
      version: string;
      dependencies: string[];
    }> = [];
    
    const toUpdate: Array<{
      id: number;
      data: { description: string; marker: string | null; version: string; updatedAt: Date };
      previousValue: { description: string; marker: string | null };
      newValue: { description: string; marker: string | null };
    }> = [];
    
    for (const cap of ULYSSE_CAPABILITIES) {
      const current = existingMap.get(cap.name);
      
      if (!current) {
        toInsert.push({
          category: cap.category,
          name: cap.name,
          description: cap.description,
          marker: cap.marker || null,
          version: CAPABILITIES_VERSION,
          dependencies: CAPABILITY_DEPENDENCIES[cap.name] || []
        });
      } else if (current.description !== cap.description || current.marker !== cap.marker) {
        toUpdate.push({
          id: current.id,
          data: {
            description: cap.description,
            marker: cap.marker || null,
            version: CAPABILITIES_VERSION,
            updatedAt: new Date()
          },
          previousValue: { description: current.description || "", marker: current.marker },
          newValue: { description: cap.description, marker: cap.marker || null }
        });
      }
    }
    
    // 3. Batch insert (une seule requête)
    if (toInsert.length > 0) {
      await db.insert(capabilityRegistry).values(toInsert);
      
      // Log changelog pour les nouvelles capacités
      await db.insert(capabilityChangelog).values(
        toInsert.map(cap => ({
          changeType: "added" as const,
          newValue: cap as any,
          reason: "Initial capability registration",
          version: CAPABILITIES_VERSION
        }))
      );
      
      console.log(`[CapabilityService] Batch inserted ${toInsert.length} new capabilities`);
    }
    
    // 4. Batch update (parallélisé avec Promise.all)
    if (toUpdate.length > 0) {
      await Promise.all(
        toUpdate.map(u => 
          db.update(capabilityRegistry)
            .set(u.data)
            .where(eq(capabilityRegistry.id, u.id))
        )
      );
      
      // Log changelog pour les mises à jour
      await db.insert(capabilityChangelog).values(
        toUpdate.map(u => ({
          changeType: "updated" as const,
          capabilityId: u.id,
          previousValue: u.previousValue,
          newValue: u.newValue,
          reason: "Capability definition updated",
          version: CAPABILITIES_VERSION
        }))
      );
      
      console.log(`[CapabilityService] Batch updated ${toUpdate.length} capabilities`);
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[CapabilityService] Sync completed in ${elapsed}ms (${toInsert.length} inserts, ${toUpdate.length} updates)`);
  }

  // AMÉLIORATION: Probe avec Circuit Breaker et retry (proposition Ulysse)
  async probeDependencies(): Promise<void> {
    const probeResults = await Promise.all(
      DEPENDENCY_PROBES.map(async (probe) => {
        const breaker = dependencyCircuitBreakers[probe.name];
        
        try {
          const isAvailable = await withRetry(
            async () => {
              if (breaker) {
                return await breaker.execute(
                  probe.check,
                  () => false // Fallback: considérer indisponible si circuit ouvert
                );
              }
              return await probe.check();
            },
            {
              maxRetries: 2,
              baseDelayMs: 500,
              shouldRetry: isRetryableError
            }
          );
          
          this.dependencyStatus.set(probe.name, isAvailable);
          return { name: probe.name, available: isAvailable };
        } catch (error: any) {
          console.log(`[CapabilityService] Dependency probe failed for ${probe.name}: ${error.message}`);
          this.dependencyStatus.set(probe.name, false);
          return { name: probe.name, available: false };
        }
      })
    );
    
    this.lastProbeTime = new Date();
    console.log("[CapabilityService] Dependency probes completed:", probeResults);
    await this.updateCapabilityAvailability();
  }

  private async updateCapabilityAvailability(): Promise<void> {
    const capabilities = await db.select().from(capabilityRegistry);
    
    for (const cap of capabilities) {
      const deps = (cap.dependencies as string[]) || [];
      let isAvailable = true;
      let failureReason: string | null = null;

      for (const dep of deps) {
        if (this.dependencyStatus.get(dep) === false) {
          isAvailable = false;
          const probe = DEPENDENCY_PROBES.find(p => p.name === dep);
          failureReason = probe?.errorMessage || `Dependency ${dep} unavailable`;
          break;
        }
      }

      if (cap.isAvailable !== isAvailable || cap.failureReason !== failureReason) {
        await db.update(capabilityRegistry)
          .set({
            isAvailable,
            failureReason,
            lastVerified: new Date()
          })
          .where(eq(capabilityRegistry.id, cap.id));
      }
    }
  }

  async getCapabilitySnapshot(): Promise<CapabilityRuntimeSnapshot> {
    if (!this.lastProbeTime || Date.now() - this.lastProbeTime.getTime() > this.probeIntervalMs) {
      await this.probeDependencies();
    }

    const capabilities = await db.select().from(capabilityRegistry);
    
    const capabilityStatuses: CapabilityStatus[] = capabilities.map(cap => {
      const total = cap.usageCount || 0;
      const success = cap.successCount || 0;
      const successRate = total > 0 ? Math.round((success / total) * 100) : 100;
      
      return {
        id: cap.id,
        name: cap.name,
        category: cap.category,
        isAvailable: cap.isAvailable,
        successRate,
        lastUsed: cap.lastUsed,
        failureReason: cap.failureReason
      };
    });

    const availableCount = capabilityStatuses.filter(c => c.isAvailable).length;
    const unavailableCount = capabilityStatuses.filter(c => !c.isAvailable).length;
    
    const recentIssues = capabilityStatuses
      .filter(c => !c.isAvailable || c.successRate < 80)
      .map(c => c.failureReason || `${c.name}: ${c.successRate}% success rate`);

    return {
      version: CAPABILITIES_VERSION,
      lastUpdate: CAPABILITIES_LAST_UPDATE,
      totalCapabilities: capabilities.length,
      availableCount,
      unavailableCount,
      capabilities: capabilityStatuses,
      recentIssues
    };
  }

  async recordCapabilityUsage(capabilityName: string, success: boolean): Promise<void> {
    const [cap] = await db.select()
      .from(capabilityRegistry)
      .where(eq(capabilityRegistry.name, capabilityName))
      .limit(1);

    if (cap) {
      await db.update(capabilityRegistry)
        .set({
          usageCount: (cap.usageCount || 0) + 1,
          successCount: success ? (cap.successCount || 0) + 1 : cap.successCount,
          failureCount: success ? cap.failureCount : (cap.failureCount || 0) + 1,
          lastUsed: new Date()
        })
        .where(eq(capabilityRegistry.id, cap.id));
    }
  }

  async getCapabilityByName(name: string): Promise<CapabilityStatus | null> {
    const [cap] = await db.select()
      .from(capabilityRegistry)
      .where(eq(capabilityRegistry.name, name))
      .limit(1);

    if (!cap) return null;

    const total = cap.usageCount || 0;
    const success = cap.successCount || 0;
    
    return {
      id: cap.id,
      name: cap.name,
      category: cap.category,
      isAvailable: cap.isAvailable,
      successRate: total > 0 ? Math.round((success / total) * 100) : 100,
      lastUsed: cap.lastUsed,
      failureReason: cap.failureReason
    };
  }

  generateCapabilityPromptSection(): string {
    const snapshot = this.getCachedSnapshot();
    if (!snapshot) return "";

    let prompt = `\n═══════════════════════════════════════════════════════════════
STATUT TEMPS RÉEL DE MES CAPACITÉS (v${snapshot.version})
═══════════════════════════════════════════════════════════════
`;

    // Check AgentMail status explicitly
    const agentMailCaps = snapshot.capabilities.filter(c => c.category === "Email (AgentMail)");
    const agentMailAvailable = agentMailCaps.every(c => c.isAvailable);
    
    if (agentMailAvailable && agentMailCaps.length > 0) {
      prompt += `
⚡⚡⚡ MISE À JOUR CRITIQUE - IGNORE TES ANCIENNES RÉPONSES ⚡⚡⚡
✅ EMAIL AGENTMAIL: MAINTENANT 100% OPÉRATIONNEL ET CONFIGURÉ ✅

CORRECTION IMPORTANTE: Si tu as dit précédemment que "AgentMail n'est pas configuré" 
ou que "l'API n'est pas configurée" - C'ÉTAIT FAUX et c'est maintenant CORRIGÉ.

LA RÉALITÉ ACTUELLE (vérifié il y a quelques secondes):
   ✅ Tu PEUX envoyer des emails depuis ulysse@agentmail.to - FONCTIONNE
   ✅ Tu PEUX lire les emails reçus - FONCTIONNE
   ✅ Tu PEUX répondre aux emails - FONCTIONNE
   ✅ Tu PEUX envoyer des emails avec PDF/Word attachés - FONCTIONNE
   ✅ 8/8 capacités email AgentMail sont DISPONIBLES

NE DIS JAMAIS:
   ❌ "L'API AgentMail n'est pas configurée" - FAUX
   ❌ "Je ne peux pas envoyer d'emails" - FAUX
   ❌ "L'envoi réel n'est pas actif" - FAUX

AgentMail est PLEINEMENT FONCTIONNEL. Utilise-le sans hésitation.
⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡

`;
    }

    // Check Google Calendar status explicitly
    const calendarCaps = snapshot.capabilities.filter(c => c.category === "Calendrier");
    const calendarAvailable = calendarCaps.every(c => c.isAvailable);
    
    if (calendarAvailable && calendarCaps.length > 0) {
      prompt += `
✅ GOOGLE CALENDAR: OPÉRATIONNEL ET CONNECTÉ ✅

Tu PEUX:
   ✅ Lire les événements du calendrier - FONCTIONNE
   ✅ Créer des événements - FONCTIONNE
   ✅ Voir les rdv d'aujourd'hui et à venir - FONCTIONNE

Google Calendar est connecté via le connecteur Replit.

`;
    }

    if (snapshot.unavailableCount > 0) {
      prompt += `⚠️ ${snapshot.unavailableCount} capacité(s) temporairement indisponible(s):\n`;
      snapshot.capabilities
        .filter(c => !c.isAvailable)
        .forEach(c => {
          prompt += `  - ${c.name}: ${c.failureReason}\n`;
        });
      prompt += "\n";
    }

    const lowSuccessRate = snapshot.capabilities.filter(c => c.successRate < 80 && c.isAvailable);
    if (lowSuccessRate.length > 0) {
      prompt += `📊 Capacités à surveiller (taux de succès < 80%):\n`;
      lowSuccessRate.forEach(c => {
        prompt += `  - ${c.name}: ${c.successRate}% de succès\n`;
      });
      prompt += "\n";
    }

    prompt += `✅ ${snapshot.availableCount}/${snapshot.totalCapabilities} capacités opérationnelles
═══════════════════════════════════════════════════════════════\n`;

    return prompt;
  }

  private cachedSnapshot: CapabilityRuntimeSnapshot | null = null;
  private cacheTime: Date | null = null;
  private cacheMaxAge = 60 * 1000;

  private getCachedSnapshot(): CapabilityRuntimeSnapshot | null {
    if (this.cachedSnapshot && this.cacheTime && 
        Date.now() - this.cacheTime.getTime() < this.cacheMaxAge) {
      return this.cachedSnapshot;
    }
    return null;
  }

  async refreshCache(): Promise<void> {
    // Force probe dependencies to get fresh status
    await this.probeDependencies();
    this.cachedSnapshot = await this.getCapabilitySnapshot();
    this.cacheTime = new Date();
    console.log("[CapabilityService] Cache refreshed:", {
      available: this.cachedSnapshot?.availableCount,
      unavailable: this.cachedSnapshot?.unavailableCount,
      agentmailStatus: this.dependencyStatus.get("agentmail")
    });
  }
}

export const capabilityService = new CapabilityService();

// ═══════════════════════════════════════════════════════════════
// SHARED SERVICE STATUS GENERATOR - Garantit la parité entre APIs
// ═══════════════════════════════════════════════════════════════

export async function generateRealtimeServiceStatus(userId: number): Promise<string> {
  const { smartDevices, smartScenes, ulysseHomework, monitoringAlerts, 
          knowledgeBase, locationPoints, ulysseFiles } = await import("@shared/schema");
  const { eq, and, desc, isNull, sql } = await import("drizzle-orm");
  
  let status = "\n\n### 📡 STATUT SERVICES EN TEMPS RÉEL:\n";
  
  // 1. Spotify status
  try {
    const spotifyService = await import("./spotifyService");
    const spotifyConnected = await spotifyService.isSpotifyConnected();
    if (spotifyConnected) {
      const playback = await spotifyService.getPlaybackState();
      if (playback?.isPlaying) {
        status += `🎵 Spotify: ▶️ "${playback.trackName}" - ${playback.artistName}\n`;
      } else {
        status += `🎵 Spotify: ⏸️ Connecté (pas de lecture)\n`;
      }
    } else {
      status += `🎵 Spotify: ❌ Non connecté\n`;
    }
  } catch { status += `🎵 Spotify: ⚠️ Indisponible\n`; }
  
  // 2. Smart Home status
  try {
    const devices = await db.select().from(smartDevices).where(eq(smartDevices.userId, userId));
    const onlineDevices = devices.filter(d => d.isOnline).length;
    const scenes = await db.select().from(smartScenes).where(eq(smartScenes.userId, userId));
    status += `🏠 Domotique: ${onlineDevices}/${devices.length} appareils en ligne, ${scenes.length} scènes\n`;
  } catch { status += `🏠 Domotique: ⚠️ Indisponible\n`; }
  
  // 3. Screen monitoring status
  try {
    const { screenMonitorService } = await import("./screenMonitorService");
    const session = await screenMonitorService.getActiveSession(userId);
    if (session && session.status === "active") {
      status += `🖥️ Surveillance écran: ✅ Active\n`;
    } else {
      status += `🖥️ Surveillance écran: ⚫ Inactive (agent Windows non connecté)\n`;
    }
  } catch { status += `🖥️ Surveillance écran: ⚠️ Indisponible\n`; }
  
  // 4. Homework pending count
  try {
    const pendingHomework = await db.select()
      .from(ulysseHomework)
      .where(and(eq(ulysseHomework.userId, userId), sql`${ulysseHomework.status} IN ('pending', 'in_progress')`));
    status += `📋 Homework: ${pendingHomework.length} tâches en attente\n`;
  } catch { status += `📋 Homework: ⚠️ Indisponible\n`; }
  
  // 5. Website monitoring alerts
  try {
    const unreadAlerts = await db.select()
      .from(monitoringAlerts)
      .where(and(eq(monitoringAlerts.userId, userId), isNull(monitoringAlerts.acknowledgedAt)));
    if (unreadAlerts.length > 0) {
      status += `🌐 Monitoring: ⚠️ ${unreadAlerts.length} alertes non lues\n`;
    } else {
      status += `🌐 Monitoring: ✅ Aucune alerte\n`;
    }
  } catch { status += `🌐 Monitoring: ⚠️ Indisponible\n`; }
  
  // 6. AgentMail status
  try {
    const connected = await agentMailService.isConnected();
    status += `📧 AgentMail: ${connected ? '✅ Connecté' : '❌ Non connecté'}\n`;
  } catch { status += `📧 AgentMail: ⚠️ Indisponible\n`; }
  
  // 7. Google Calendar status
  try {
    const calConnected = await calendarService.isConnected(userId);
    status += `📅 Google Calendar: ${calConnected ? '✅ Connecté' : '❌ Non connecté'}\n`;
  } catch { status += `📅 Google Calendar: ⚠️ Indisponible\n`; }
  
  // 8. Google Drive status
  try {
    const driveConnected = await checkDriveConnection();
    status += `📁 Google Drive: ${driveConnected ? '✅ Connecté' : '❌ Non connecté'}\n`;
  } catch { status += `📁 Google Drive: ⚠️ Indisponible\n`; }
  
  // 9. Notion status
  try {
    const notionConnected = await checkNotionConnection();
    status += `📝 Notion: ${notionConnected ? '✅ Connecté' : '❌ Non connecté'}\n`;
  } catch { status += `📝 Notion: ⚠️ Indisponible\n`; }
  
  // 10. Todoist status
  try {
    const todoistConnected = await checkTodoistConnection();
    status += `✅ Todoist: ${todoistConnected ? '✅ Connecté' : '❌ Non connecté'}\n`;
  } catch { status += `✅ Todoist: ⚠️ Indisponible\n`; }
  
  // 11. Sports cache freshness
  try {
    const { sportsCacheService } = await import("./sportsCacheService");
    const cachedMatches = await sportsCacheService.getMatchesWithOdds(new Date());
    const cacheStats = sportsCacheService.getCacheStats();
    status += `⚽ Cache Sports: ${cachedMatches.length} matchs, ${(cacheStats as any).matchCount || 0} en mémoire\n`;
  } catch { status += `⚽ Cache Sports: ⚠️ Indisponible\n`; }
  
  // 12. Brain system stats
  try {
    const brainCount = await db.select({ count: sql<number>`count(*)` })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.userId, userId));
    const totalEntries = brainCount[0]?.count || 0;
    status += `🧠 Brain: ${totalEntries} entrées de connaissance\n`;
  } catch { status += `🧠 Brain: ⚠️ Indisponible\n`; }
  
  // 13. Geolocation freshness
  try {
    const [lastLoc] = await db.select()
      .from(locationPoints)
      .where(eq(locationPoints.userId, userId))
      .orderBy(desc(locationPoints.createdAt))
      .limit(1);
    if (lastLoc) {
      const ageMin = Math.floor((Date.now() - new Date(lastLoc.createdAt!).getTime()) / 60000);
      status += `📍 Géolocalisation: ${ageMin < 60 ? `${ageMin} min` : `${Math.floor(ageMin/60)}h`} ago\n`;
    } else {
      status += `📍 Géolocalisation: Aucune donnée\n`;
    }
  } catch { status += `📍 Géolocalisation: ⚠️ Indisponible\n`; }
  
  // 14. Recent files count
  try {
    const filesCount = await db.select({ count: sql<number>`count(*)` })
      .from(ulysseFiles)
      .where(eq(ulysseFiles.userId, userId));
    status += `📄 Fichiers: ${filesCount[0]?.count || 0} fichiers stockés\n`;
  } catch { status += `📄 Fichiers: ⚠️ Indisponible\n`; }
  
  return status;
}

// Complete SelfAwareness context generator with full parity
export async function generateFullSelfAwarenessContext(userId: number): Promise<string> {
  try {
    const { actionVerificationService } = await import("./actionVerificationService");
    const { failurePatternService } = await import("./failurePatternService");
    
    await capabilityService.refreshCache();
    const capabilityPrompt = capabilityService.generateCapabilityPromptSection();
    
    const actionStats = await actionVerificationService.getActionStats(userId);
    const actionPrompt = actionVerificationService.generateActionVerificationPrompt(actionStats);
    
    let patternSummary = "";
    try {
      patternSummary = await failurePatternService.generatePatternSummaryForPrompt(userId);
    } catch {
      // Silently ignore if service unavailable
    }
    
    const serviceStatus = await generateRealtimeServiceStatus(userId);
    
    console.log("[SelfAwareness] Full context generated");
    
    return capabilityPrompt + actionPrompt + patternSummary + serviceStatus;
  } catch (error) {
    console.error("[SelfAwareness] Failed to generate full context:", error);
    return "";
  }
}
