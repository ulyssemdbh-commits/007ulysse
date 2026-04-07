/**
 * Request Analysis Service v2
 * Intelligent domain detection for routing context and MARS strategies
 */

export type RequestDomain = 
  | "general"
  | "code"
  | "dev_diagnostics"
  | "sports"
  | "betting"
  | "calendar"
  | "email"
  | "music"
  | "smart_home"
  | "search";

export interface RequestAnalysis {
  domain: RequestDomain;
  isOwner: boolean;
  requiresHighReliability: boolean;
  keywords: string[];
  confidence: number;
  subDomain?: string;
}

const CODE_KEYWORDS = [
  "code", "codebase", "implementation", "function", "method", "class",
  "bug", "error", "fix", "debug", "issue", "problem", "crash",
  "file", "source", "script", "component", "service", "route",
  "backend", "frontend", "server", "client", "api", "endpoint",
  "analyze", "review", "check", "examine", "look at", "inspect",
  "improve", "optimize", "refactor", "update", "modify", "change",
  "schema", "database", "migration", "table", "column",
  "hook", "state", "props", "render", "style", "css",
  "typescript", "javascript", "react", "express", "node"
];

const DIAGNOSTIC_KEYWORDS = [
  "diagnostic", "health", "status", "monitor", "performance",
  "memory", "cpu", "latency", "slow", "fast", "speed",
  "working", "broken", "failing", "success", "failure",
  "metric", "stat", "log", "trace", "debug"
];

const SPORTS_KEYWORDS = [
  "foot", "football", "ligue 1", "premier league", "la liga", "serie a", "bundesliga",
  "champions league", "match", "score", "classement", "standings", "équipe", "team",
  "psg", "om", "ol", "marseille", "paris", "lyon", "monaco", "lille", "rennes",
  "arsenal", "chelsea", "liverpool", "manchester", "real madrid", "barcelona", "barca",
  "juventus", "inter", "milan", "bayern", "dortmund",
  "nba", "basket", "hockey", "nhl", "nfl", "tennis", "rugby",
  "joueur", "player", "but", "goal", "victoire", "défaite", "nul", "draw",
  "journée", "saison", "transfert"
];

const BETTING_KEYWORDS = [
  "prono", "pronostic", "paris", "pari", "bet", "betting", "cote", "cotes", "odds",
  "winamax", "betclic", "unibet", "parionssport", "fdj", "zebet", "pmu",
  "1n2", "over", "under", "btts", "handicap", "combo", "combiné",
  "valeur", "value", "stake", "mise", "bankroll", "roi",
  "prediction", "prédiction", "analyse", "tip", "conseils paris"
];

const CALENDAR_KEYWORDS = [
  "calendrier", "calendar", "rdv", "rendez-vous", "meeting", "réunion",
  "événement", "event", "agenda", "planning", "demain", "aujourd'hui",
  "semaine", "mois", "programmer", "schedule", "rappel", "reminder"
];

const EMAIL_KEYWORDS = [
  "email", "mail", "message", "envoyer", "send", "répondre", "reply",
  "inbox", "boîte", "courrier", "agentmail", "iris", "alfred"
];

const MUSIC_KEYWORDS = [
  "musique", "music", "spotify", "chanson", "song", "album", "artiste", "artist",
  "playlist", "jouer", "play", "pause", "suivant", "next", "précédent", "previous",
  "volume", "écouter", "listen"
];

const SMART_HOME_KEYWORDS = [
  "lumière", "light", "lampe", "lamp", "allumer", "éteindre",
  "domotique", "smart home", "scène domotique", "scene domotique",
  "philips hue", "hue", "homekit", "netatmo", "thermostat connecté", "température maison"
];

const SEARCH_KEYWORDS = [
  "cherche sur le web", "search online", "trouve sur internet", "recherche web",
  "internet search", "google search", "information web", "actualité", "news today"
];

function countMatches(text: string, keywords: string[]): { count: number; matched: string[] } {
  const lower = text.toLowerCase();
  const matched = keywords.filter(kw => lower.includes(kw.toLowerCase()));
  return { count: matched.length, matched };
}

function calculateConfidence(matches: number, totalKeywords: number): number {
  if (matches === 0) return 0;
  if (matches >= 3) return 0.95;
  if (matches === 2) return 0.85;
  return 0.6;
}

export const requestAnalysisService = {
  analyze(userMessage: string, isOwner: boolean): RequestAnalysis {
    const text = userMessage.toLowerCase();
    
    const results = {
      code: countMatches(text, CODE_KEYWORDS),
      diagnostics: countMatches(text, DIAGNOSTIC_KEYWORDS),
      sports: countMatches(text, SPORTS_KEYWORDS),
      betting: countMatches(text, BETTING_KEYWORDS),
      calendar: countMatches(text, CALENDAR_KEYWORDS),
      email: countMatches(text, EMAIL_KEYWORDS),
      music: countMatches(text, MUSIC_KEYWORDS),
      smartHome: countMatches(text, SMART_HOME_KEYWORDS),
      search: countMatches(text, SEARCH_KEYWORDS)
    };

    const scores: { domain: RequestDomain; score: number; keywords: string[] }[] = [
      { domain: "betting", score: results.betting.count * 2, keywords: results.betting.matched },
      { domain: "sports", score: results.sports.count * 1.5, keywords: results.sports.matched },
      { domain: "dev_diagnostics", score: results.code.count + results.diagnostics.count * 1.5, keywords: [...results.code.matched, ...results.diagnostics.matched] },
      { domain: "code", score: results.code.count, keywords: results.code.matched },
      { domain: "calendar", score: results.calendar.count, keywords: results.calendar.matched },
      { domain: "email", score: results.email.count, keywords: results.email.matched },
      { domain: "music", score: results.music.count, keywords: results.music.matched },
      { domain: "smart_home", score: results.smartHome.count, keywords: results.smartHome.matched },
      { domain: "search", score: results.search.count * 0.5, keywords: results.search.matched }
    ];

    scores.sort((a, b) => b.score - a.score);
    const topResult = scores[0];

    if (topResult.score === 0) {
      return {
        domain: "general",
        isOwner,
        requiresHighReliability: false,
        keywords: [],
        confidence: 1.0
      };
    }

    if (!isOwner && (topResult.domain === "code" || topResult.domain === "dev_diagnostics")) {
      return {
        domain: "general",
        isOwner,
        requiresHighReliability: false,
        keywords: topResult.keywords,
        confidence: 0.5
      };
    }

    const requiresHighReliability = 
      topResult.domain === "betting" ||
      topResult.domain === "sports" ||
      topResult.domain === "calendar" ||
      (topResult.domain === "code" && results.diagnostics.count > 0);

    let subDomain: string | undefined;
    if (topResult.domain === "sports" || topResult.domain === "betting") {
      if (text.includes("ligue 1") || /om|psg|ol|monaco|lille|rennes|marseille|paris|lyon/.test(text)) {
        subDomain = "ligue1";
      } else if (text.includes("premier league") || /arsenal|chelsea|liverpool|manchester/.test(text)) {
        subDomain = "premier_league";
      } else if (text.includes("la liga") || /real madrid|barcelona|barca|atletico/.test(text)) {
        subDomain = "laliga";
      } else if (text.includes("serie a") || /juventus|inter|milan|napoli|roma/.test(text)) {
        subDomain = "seriea";
      } else if (text.includes("bundesliga") || /bayern|dortmund|leipzig/.test(text)) {
        subDomain = "bundesliga";
      } else if (text.includes("nba") || text.includes("basket")) {
        subDomain = "nba";
      } else if (text.includes("nfl")) {
        subDomain = "nfl";
      } else if (text.includes("nhl") || text.includes("hockey")) {
        subDomain = "nhl";
      }
    }

    return {
      domain: topResult.domain,
      isOwner,
      requiresHighReliability,
      keywords: topResult.keywords,
      confidence: calculateConfidence(topResult.keywords.length, 5),
      subDomain
    };
  },

  containsCodeKeywords(text: string): boolean {
    const lower = text.toLowerCase();
    return CODE_KEYWORDS.some(kw => lower.includes(kw));
  },

  containsDiagnosticKeywords(text: string): boolean {
    const lower = text.toLowerCase();
    return DIAGNOSTIC_KEYWORDS.some(kw => lower.includes(kw));
  },

  containsSportsKeywords(text: string): boolean {
    const lower = text.toLowerCase();
    return SPORTS_KEYWORDS.some(kw => lower.includes(kw)) || BETTING_KEYWORDS.some(kw => lower.includes(kw));
  },

  getKeywordCategories(): string[] {
    return ["code", "diagnostics", "sports", "betting", "calendar", "email", "music", "smartHome", "search"];
  }
};
