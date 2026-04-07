/**
 * FEEDBACK PROTOCOL OK/NOT OK V1
 * 
 * Protocole de renforcement direct depuis le chat.
 * Maurice peut dire:
 * - "Ça, c'est OK" → Comportement à renforcer
 * - "Ça, c'est pas OK" → Comportement à bannir
 * - "Standard à reproduire" → Template de réponse idéale
 * - "Jamais plus" → Anti-pattern permanent
 * 
 * Alimente: satisfaction KPI, auto-learning, correction rules
 */

const LOG_PREFIX = "[Feedback]";

export interface FeedbackEntry {
  id: string;
  type: "ok" | "not_ok" | "standard" | "ban" | "preference";
  domain: string;
  trigger: string;
  description: string;
  context?: string;
  createdAt: number;
  reinforcementCount: number;
}

interface FeedbackPattern {
  pattern: RegExp;
  type: FeedbackEntry["type"];
  extractDescription: (query: string) => string;
}

class FeedbackProtocolService {
  private entries: FeedbackEntry[] = [];
  private maxEntries = 200;

  private patterns: FeedbackPattern[] = [
    { pattern: /^(ça|c'est)\s*(c'est\s+)?ok|^ok\s*ça|^bien\s+ça|^parfait\s+ça|^exactement|^c'est\s+ça|^nickel|^impec/i, type: "ok", extractDescription: (q) => q },
    { pattern: /^(ça|c'est)\s*(c'est\s+)?(pas|plus)\s+ok|^pas\s+ok|^non\s+(pas|jamais)\s+comme\s+ça|^arrête|^stop\s+ça/i, type: "not_ok", extractDescription: (q) => q },
    { pattern: /standard\s+à\s+reproduire|comme\s+ça\s+toujours|type\s+de\s+réponse\s+idéal|modèle\s+à\s+suivre/i, type: "standard", extractDescription: (q) => q },
    { pattern: /jamais\s+plus|plus\s+jamais|ne\s+fais\s+plus|interdit|banni/i, type: "ban", extractDescription: (q) => q },
    { pattern: /je\s+préfère|j'aime\s+mieux|à\s+l'avenir|dorénavant|désormais/i, type: "preference", extractDescription: (q) => q }
  ];

  detectFeedback(query: string, domain: string, previousResponse?: string): FeedbackEntry | null {
    for (const p of this.patterns) {
      if (p.pattern.test(query)) {
        const entry: FeedbackEntry = {
          id: `fb_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          type: p.type,
          domain,
          trigger: query,
          description: p.extractDescription(query),
          context: previousResponse?.substring(0, 200),
          createdAt: Date.now(),
          reinforcementCount: 1
        };

        const existing = this.entries.find(e => 
          e.type === entry.type && 
          e.domain === entry.domain && 
          this.isSimilar(e.trigger, entry.trigger)
        );

        if (existing) {
          existing.reinforcementCount++;
          existing.createdAt = Date.now();
          console.log(`${LOG_PREFIX} Reinforced feedback: ${existing.type} (${existing.reinforcementCount}x)`);
          return existing;
        }

        this.entries.push(entry);
        if (this.entries.length > this.maxEntries) {
          this.entries = this.entries.slice(-this.maxEntries);
        }

        console.log(`${LOG_PREFIX} New feedback: ${entry.type} in ${domain}: ${entry.trigger.substring(0, 50)}`);
        return entry;
      }
    }
    return null;
  }

  private test(query: string): FeedbackPattern | null {
    for (const p of this.patterns) {
      if (p.pattern.test(query)) return p;
    }
    return null;
  }

  isFeedbackMessage(query: string): boolean {
    return this.test(query) !== null;
  }

  private isSimilar(a: string, b: string): boolean {
    const wordsA = a.toLowerCase().split(/\s+/);
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    let common = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) common++;
    }
    const total = Math.max(wordsA.length, wordsB.size);
    return total > 0 && common / total > 0.6;
  }

  getStandards(domain?: string): FeedbackEntry[] {
    return this.entries.filter(e => 
      e.type === "standard" && (!domain || e.domain === domain)
    ).sort((a, b) => b.reinforcementCount - a.reinforcementCount);
  }

  getBans(domain?: string): FeedbackEntry[] {
    return this.entries.filter(e => 
      e.type === "ban" && (!domain || e.domain === domain)
    );
  }

  getPreferences(domain?: string): FeedbackEntry[] {
    return this.entries.filter(e => 
      (e.type === "ok" || e.type === "preference") && 
      e.reinforcementCount >= 2 &&
      (!domain || e.domain === domain)
    );
  }

  generateFeedbackPrompt(domain?: string): string {
    const standards = this.getStandards(domain);
    const bans = this.getBans(domain);
    const prefs = this.getPreferences(domain);

    if (standards.length === 0 && bans.length === 0 && prefs.length === 0) return "";

    const parts: string[] = ["\n[FEEDBACK PROPRIÉTAIRE - Comportements appris]"];

    if (standards.length > 0) {
      parts.push("Standards à reproduire:");
      for (const s of standards.slice(0, 3)) {
        parts.push(`  ✓ ${s.description.substring(0, 100)} (renforcé ${s.reinforcementCount}x)`);
      }
    }

    if (bans.length > 0) {
      parts.push("Comportements INTERDITS:");
      for (const b of bans.slice(0, 3)) {
        parts.push(`  ✗ ${b.description.substring(0, 100)}`);
      }
    }

    if (prefs.length > 0) {
      parts.push("Préférences confirmées:");
      for (const p of prefs.slice(0, 3)) {
        parts.push(`  → ${p.description.substring(0, 100)}`);
      }
    }

    return parts.join("\n");
  }

  getStats(): { total: number; byType: Record<string, number>; strongSignals: number } {
    const byType: Record<string, number> = {};
    let strong = 0;
    for (const e of this.entries) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      if (e.reinforcementCount >= 3) strong++;
    }
    return { total: this.entries.length, byType, strongSignals: strong };
  }
}

export const feedbackProtocolService = new FeedbackProtocolService();
