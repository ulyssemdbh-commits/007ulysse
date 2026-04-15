import { getOpenAI } from "./core/openaiClient";
import { db } from "../db";
import { suguPurchases } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

interface IdentifiedIngredient {
  name: string;
  quantity?: string;
  freshness?: string;
  category: string;
}

interface SupplierMatch {
  ingredient: string;
  supplierRef?: string;
  supplierName?: string;
  lastPrice?: number;
  unit?: string;
  lastPurchaseDate?: string;
}

interface MenuSuggestion {
  name: string;
  ingredients: string[];
  estimatedCost: number;
  suggestedPrice: number;
  margin: number;
  difficulty: "facile" | "moyen" | "difficile";
  prepTime: string;
}

interface VisionAnalysisResult {
  success: boolean;
  ingredients: IdentifiedIngredient[];
  supplierMatches: SupplierMatch[];
  menuSuggestions: MenuSuggestion[];
  totalEstimatedValue: number;
  tips: string[];
  error?: string;
}

class VisionLiveService {
  private static instance: VisionLiveService;
  static getInstance(): VisionLiveService {
    if (!this.instance) this.instance = new VisionLiveService();
    return this.instance;
  }

  async analyzeImage(imageBase64: string, mimeType: string = "image/jpeg", restaurant: string = "suguval"): Promise<VisionAnalysisResult> {
    try {
      const openai = getOpenAI();

      const visionResponse = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `Tu es un chef cuisinier expert et gestionnaire de restaurant. Analyse cette image et identifie TOUS les ingrédients/produits alimentaires visibles.
Pour chaque ingrédient, donne:
- name: nom en français
- quantity: estimation de la quantité visible
- freshness: état de fraîcheur (frais/correct/à consommer vite/périmé)
- category: catégorie (viande, poisson, légume, fruit, épice, produit laitier, boisson, sec, surgelé, autre)

Puis suggère 3 plats de restaurant réalisables avec ces ingrédients.
Pour chaque plat:
- name: nom du plat
- ingredients: liste des ingrédients de l'image utilisés
- estimatedCost: coût matière estimé en euros
- suggestedPrice: prix de vente suggéré (ratio x3 du coût)
- margin: marge en pourcentage
- difficulty: facile/moyen/difficile
- prepTime: temps de préparation

Réponds UNIQUEMENT en JSON valide:
{
  "ingredients": [...],
  "menuSuggestions": [...],
  "tips": ["conseil 1", "conseil 2"]
}`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyse cette image et identifie tous les ingrédients visibles. Suggère des plats de restaurant." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      });

      const content = visionResponse.choices[0]?.message?.content || "";
      let parsed: any;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      } catch {
        return { success: false, ingredients: [], supplierMatches: [], menuSuggestions: [], totalEstimatedValue: 0, tips: [], error: "Impossible de parser la réponse vision" };
      }

      const ingredients: IdentifiedIngredient[] = parsed.ingredients || [];
      const menuSuggestions: MenuSuggestion[] = parsed.menuSuggestions || [];

      const supplierMatches = await this.matchWithSuppliers(ingredients, restaurant);

      const totalEstimatedValue = supplierMatches.reduce((sum, m) => sum + (m.lastPrice || 0), 0);

      for (const menu of menuSuggestions) {
        const matchedCosts = menu.ingredients.map(ing => {
          const match = supplierMatches.find(m =>
            m.ingredient.toLowerCase().includes(ing.toLowerCase()) ||
            ing.toLowerCase().includes(m.ingredient.toLowerCase())
          );
          return match?.lastPrice || 0;
        });
        const realCost = matchedCosts.reduce((a, b) => a + b, 0);
        if (realCost > 0) {
          menu.estimatedCost = Math.round(realCost * 100) / 100;
          menu.suggestedPrice = Math.round(realCost * 3 * 100) / 100;
          menu.margin = Math.round((1 - realCost / menu.suggestedPrice) * 100);
        }
      }

      console.log(`[VisionLive] Analyzed: ${ingredients.length} ingredients, ${menuSuggestions.length} menu suggestions, ${supplierMatches.filter(m => m.lastPrice).length} supplier matches`);

      return {
        success: true,
        ingredients,
        supplierMatches,
        menuSuggestions,
        totalEstimatedValue: Math.round(totalEstimatedValue * 100) / 100,
        tips: parsed.tips || []
      };
    } catch (error: any) {
      console.error("[VisionLive] Error:", error.message);
      return { success: false, ingredients: [], supplierMatches: [], menuSuggestions: [], totalEstimatedValue: 0, tips: [], error: error.message };
    }
  }

  private async matchWithSuppliers(ingredients: IdentifiedIngredient[], restaurant: string): Promise<SupplierMatch[]> {
    const matches: SupplierMatch[] = [];

    try {
      const recentPurchases = await db.select()
        .from(suguPurchases)
        .where(eq(suguPurchases.restaurant, restaurant))
        .orderBy(desc(suguPurchases.date))
        .limit(300);

      for (const ing of ingredients) {
        const ingWords = ing.name.toLowerCase().split(/\s+/);
        const match = recentPurchases.find((p: any) => {
          const label = ((p as any).label || (p as any).fournisseur || "").toLowerCase();
          return ingWords.some(w => w.length > 3 && label.includes(w));
        });

        matches.push({
          ingredient: ing.name,
          supplierRef: match ? String((match as any).reference || "") : undefined,
          supplierName: match ? String((match as any).fournisseur || "") : undefined,
          lastPrice: match ? Number((match as any).montant || (match as any).totalHt || 0) : undefined,
          unit: match ? String((match as any).unite || "") : undefined,
          lastPurchaseDate: match ? String((match as any).date || "") : undefined
        });
      }
    } catch (err) {
      console.error("[VisionLive] Supplier matching error:", err);
      for (const ing of ingredients) {
        matches.push({ ingredient: ing.name });
      }
    }

    return matches;
  }
}

export const visionLiveService = VisionLiveService.getInstance();
