import { db } from "../db";
import { userConversationalPreferences, UserConversationalPreference } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

interface PreferenceAnalysis {
  responseLength: "short" | "medium" | "detailed";
  formality: "casual" | "neutral" | "formal";
  language: string;
  technicalLevel: "simple" | "moderate" | "advanced";
  emojiUsage: boolean;
}

class ConversationalPreferencesService {
  private readonly PREFERENCE_TYPES = [
    "response_length",
    "formality",
    "language",
    "technical_level",
    "emoji_usage",
  ] as const;

  async analyzeResponsePreference(
    userId: number,
    message: string,
    response: string
  ): Promise<void> {
    try {
      const analysis = this.analyzeMessage(message);

      if (analysis.responseLength) {
        await this.updatePreference(userId, "response_length", analysis.responseLength, "auto");
      }
      if (analysis.formality) {
        await this.updatePreference(userId, "formality", analysis.formality, "auto");
      }
      if (analysis.language) {
        await this.updatePreference(userId, "language", analysis.language, "auto");
      }
      if (analysis.technicalLevel) {
        await this.updatePreference(userId, "technical_level", analysis.technicalLevel, "auto");
      }
      await this.updatePreference(userId, "emoji_usage", analysis.emojiUsage ? "true" : "false", "auto");
    } catch (error) {
      console.error("[ConversationalPreferences] Error analyzing preferences:", error);
    }
  }

  private analyzeMessage(message: string): PreferenceAnalysis {
    const msgLower = message.toLowerCase().trim();
    const wordCount = msgLower.split(/\s+/).length;

    let responseLength: "short" | "medium" | "detailed" = "medium";
    if (wordCount <= 5) {
      responseLength = "short";
    } else if (wordCount >= 30) {
      responseLength = "detailed";
    }

    if (/en détail|explique|développe|approfondi/i.test(message)) {
      responseLength = "detailed";
    }
    if (/en bref|résume|vite|rapide|court/i.test(message)) {
      responseLength = "short";
    }

    let formality: "casual" | "neutral" | "formal" = "neutral";
    if (/salut|coucou|hey|wesh|slt|yo |mdr|lol|ptdr/i.test(message)) {
      formality = "casual";
    } else if (/monsieur|madame|veuillez|cordialement|je vous prie/i.test(message)) {
      formality = "formal";
    }

    let language = "fr";
    const frenchWords = (message.match(/\b(le|la|les|de|du|des|un|une|est|et|en|que|qui|pour|dans|ce|il|ne|se|je|tu|nous|vous|avec|sur|pas|son|sa|ses|mais|ou|donc)\b/gi) || []).length;
    const englishWords = (message.match(/\b(the|is|are|was|were|have|has|been|will|would|could|should|and|but|or|for|not|you|this|that|with|from|can|do|does|did|its|my|your|he|she|we|they)\b/gi) || []).length;
    const totalWords = wordCount || 1;
    if (englishWords / totalWords > 0.3 && englishWords > frenchWords) {
      language = "en";
    }

    let technicalLevel: "simple" | "moderate" | "advanced" = "moderate";
    if (/API|backend|frontend|docker|kubernetes|SQL|regex|webhook|endpoint|deploy|pipeline|microservice|CI\/CD|git|npm|yarn/i.test(message)) {
      technicalLevel = "advanced";
    } else if (/code|script|programme|fonction|variable|serveur|base de données|algorithme/i.test(message)) {
      technicalLevel = "moderate";
    } else if (wordCount < 10 && !/\b(code|dev|tech)\b/i.test(message)) {
      technicalLevel = "simple";
    }

    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    const emojiUsage = emojiRegex.test(message);

    return { responseLength, formality, language, technicalLevel, emojiUsage };
  }

  private async updatePreference(
    userId: number,
    preferenceType: string,
    value: string,
    learnedFrom: string
  ): Promise<void> {
    const existing = await db
      .select()
      .from(userConversationalPreferences)
      .where(
        and(
          eq(userConversationalPreferences.userId, userId),
          eq(userConversationalPreferences.preferenceType, preferenceType)
        )
      );

    if (existing.length > 0) {
      const current = existing[0];
      if (current.value === value) {
        const newCount = current.sampleCount + 1;
        const newConfidence = Math.min(1.0, current.confidence + 0.05);
        await db
          .update(userConversationalPreferences)
          .set({
            confidence: newConfidence,
            sampleCount: newCount,
            updatedAt: new Date(),
          })
          .where(eq(userConversationalPreferences.id, current.id));
      } else {
        const currentWeight = current.confidence * current.sampleCount;
        const newWeight = 1;
        const totalSamples = current.sampleCount + 1;

        if (newWeight / totalSamples > 0.4) {
          const newConfidence = Math.max(0.3, current.confidence - 0.1);
          await db
            .update(userConversationalPreferences)
            .set({
              value,
              confidence: newConfidence,
              sampleCount: totalSamples,
              learnedFrom,
              updatedAt: new Date(),
            })
            .where(eq(userConversationalPreferences.id, current.id));
        } else {
          await db
            .update(userConversationalPreferences)
            .set({
              sampleCount: totalSamples,
              updatedAt: new Date(),
            })
            .where(eq(userConversationalPreferences.id, current.id));
        }
      }
    } else {
      await db.insert(userConversationalPreferences).values({
        userId,
        preferenceType,
        value,
        confidence: 0.5,
        learnedFrom,
        sampleCount: 1,
      });
    }
  }

  async getPreferencesPrompt(userId: number): Promise<string> {
    const preferences = await db
      .select()
      .from(userConversationalPreferences)
      .where(
        and(
          eq(userConversationalPreferences.userId, userId)
        )
      )
      .orderBy(desc(userConversationalPreferences.confidence));

    if (preferences.length === 0) return "";

    const highConfidence = preferences.filter((p) => p.confidence >= 0.6);
    if (highConfidence.length === 0) return "";

    const instructions: string[] = [];

    for (const pref of highConfidence) {
      switch (pref.preferenceType) {
        case "response_length":
          if (pref.value === "short") {
            instructions.push("Cet utilisateur préfère des réponses courtes et directes (2-3 phrases max).");
          } else if (pref.value === "detailed") {
            instructions.push("Cet utilisateur apprécie les réponses détaillées et complètes.");
          }
          break;

        case "formality":
          if (pref.value === "casual") {
            instructions.push("Adopte un ton décontracté et familier avec cet utilisateur.");
          } else if (pref.value === "formal") {
            instructions.push("Utilise un registre formel et professionnel avec cet utilisateur.");
          }
          break;

        case "language":
          if (pref.value === "en") {
            instructions.push("This user often communicates in English. Respond in English when they write in English.");
          }
          break;

        case "technical_level":
          if (pref.value === "advanced") {
            instructions.push("Cet utilisateur a un niveau technique avancé. Tu peux utiliser du jargon technique.");
          } else if (pref.value === "simple") {
            instructions.push("Cet utilisateur préfère des explications simples et accessibles.");
          }
          break;

        case "emoji_usage":
          break;
      }
    }

    if (instructions.length === 0) return "";

    return `\n[PRÉFÉRENCES UTILISATEUR APPRISES]\n${instructions.join("\n")}`;
  }

  async learnFromFeedback(
    userId: number,
    messageId: number,
    feedback: "too_long" | "too_short" | "too_formal" | "too_casual" | "good" | "bad"
  ): Promise<void> {
    const feedbackMappings: Record<string, { type: string; value: string }> = {
      too_long: { type: "response_length", value: "short" },
      too_short: { type: "response_length", value: "detailed" },
      too_formal: { type: "formality", value: "casual" },
      too_casual: { type: "formality", value: "formal" },
    };

    const mapping = feedbackMappings[feedback];
    if (mapping) {
      await this.updatePreference(userId, mapping.type, mapping.value, "explicit_feedback");
    }
  }

  async getUserPreferences(userId: number): Promise<UserConversationalPreference[]> {
    return db
      .select()
      .from(userConversationalPreferences)
      .where(eq(userConversationalPreferences.userId, userId))
      .orderBy(desc(userConversationalPreferences.confidence));
  }
}

export const conversationalPreferencesService = new ConversationalPreferencesService();
