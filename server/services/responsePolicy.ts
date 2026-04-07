/**
 * MARS - Response Policy (Strict Mode)
 * Anti-approximation and hallucination prevention
 * 
 * Rules:
 * 1. Minimum 2 reliable sources (score ≥60) for factual claims
 * 2. OR 1 ultra-reliable source (score ≥85) with no contradiction
 * 3. Temporal data must be fresh
 * 4. Explicit uncertainty marking
 */

import { ExtractedFact, FactAggregation } from "./factAggregator";
import { ReliabilityScore } from "./reliabilityScorer";

export type QueryType = "factual" | "temporal" | "opinion" | "definition" | "howto" | "news" | "conversational" | "sports_football" | "sports_basketball" | "sports_motorsport";

export interface PolicyDecision {
  canRespond: boolean;
  confidenceLevel: "high" | "medium" | "low" | "insufficient";
  reasoning: string;
  warnings: string[];
  recommendations: string[];
  mustDisclaim: boolean;
  disclaimers: string[];
}

export interface ResponseTemplate {
  prefix: string;
  suffix: string;
  uncertaintyMarkers: string[];
}

const TEMPORAL_KEYWORDS = [
  "aujourd'hui", "actuellement", "maintenant", "récemment",
  "cette semaine", "ce mois", "cette année", "2026", "2025",
  "dernier", "dernière", "derniers", "dernières",
  "score", "résultat", "match", "météo", "prix", "cours",
  "classement", "position", "rang"
];

const NEWS_KEYWORDS = [
  "news", "actualité", "nouvelle", "breaking",
  "annonce", "déclaration", "événement"
];

const CONVERSATIONAL_PATTERNS = [
  /^(salut|bonjour|bonsoir|coucou|hey|hé|hello|hi)\s*[,!]?\s*/i,
  /tu (es|deviens|m'entends|sais|fais|as|parles)/i,
  /(merci|bravo|super|génial|excellent|bien joué|cool|nice|parfait)/i,
  /(à toi|c'est tout|voilà|ok|d'accord|compris|entendu)/i,
  /^(oui|non|ouais|nope|yep|nan|mouais)\s*[,!.]?\s*$/i,
  /(comment (ça va|vas-tu|tu vas)|ça va)/i,
  /(je t'aime|t'es le meilleur|tu gères|t'assures)/i,
  // SUPER ULYSSE: Removed overly broad "no question mark" pattern that blocked factual queries
];

const QUESTION_INDICATORS = [
  "?", "qui", "quoi", "quand", "où", "pourquoi", "combien",
  "cherche", "trouve", "quel", "quelle", "quels", "quelles",
  "est-ce que", "sais-tu", "peux-tu", "connais-tu"
];

function isConversational(query: string): boolean {
  const queryLower = query.toLowerCase().trim();
  
  if (queryLower.length > 150) return false;
  
  for (const indicator of QUESTION_INDICATORS) {
    if (queryLower.includes(indicator)) return false;
  }
  
  for (const pattern of CONVERSATIONAL_PATTERNS) {
    if (pattern.test(queryLower)) return true;
  }
  
  const words = queryLower.split(/\s+/);
  if (words.length <= 15 && !queryLower.includes("?")) {
    // SUPER ULYSSE: Extended factual keywords including sports queries
    const factualKeywords = [
      // General factual
      "prix", "score", "résultat", "date", "heure", "météo", "news", "actualité",
      // Sports - rankings and standings  
      "classement", "classements", "ranking", "rankings", "position", "place", "points",
      "buteur", "buteurs", "scorer", "scorers", "top", "meilleur", "meilleurs",
      // Sports - leagues and teams
      "ligue", "league", "premier", "serie", "bundesliga", "liga", "championnat",
      "psg", "marseille", "lyon", "monaco", "barcelona", "real", "manchester", "arsenal",
      // Sports - betting and odds
      "cote", "cotes", "odds", "pari", "paris", "pronostic", "pronostics",
      // Sports - matches
      "match", "matchs", "matches", "victoire", "défaite", "nul", "gagné", "perdu",
      // Data queries
      "combien", "quel", "quelle", "quels", "quelles", "liste", "données"
    ];
    const hasFactualKeyword = factualKeywords.some(k => queryLower.includes(k));
    if (!hasFactualKeyword) return true;
  }
  
  return false;
}

export function classifyQuery(query: string): QueryType {
  const queryLower = query.toLowerCase();
  
  if (isConversational(query)) {
    console.log(`[MARS] Skipping search for conversational message: "${query.slice(0, 50)}..."`);
    return "conversational";
  }
  
  for (const keyword of TEMPORAL_KEYWORDS) {
    if (queryLower.includes(keyword)) {
      return "temporal";
    }
  }
  
  for (const keyword of NEWS_KEYWORDS) {
    if (queryLower.includes(keyword)) {
      return "news";
    }
  }
  
  if (queryLower.includes("comment") || queryLower.includes("how to") || 
      queryLower.includes("tutoriel") || queryLower.includes("étape")) {
    return "howto";
  }
  
  if (queryLower.includes("définition") || queryLower.includes("qu'est-ce que") ||
      queryLower.includes("c'est quoi")) {
    return "definition";
  }
  
  if (queryLower.includes("ton avis") || queryLower.includes("que penses-tu") ||
      queryLower.includes("meilleur") || queryLower.includes("recommande")) {
    return "opinion";
  }
  
  // ══════════════════════════════════════════════════════════════════
  // SPORTS QUERY CLASSIFICATION - Route to specialized handlers
  // ══════════════════════════════════════════════════════════════════
  const footballKeywords = [
    "ligue des champions", "champions league", "ldc",
    "ligue 1", "ligue1", "l1",
    "premier league", "pl ",
    "la liga", "liga",
    "serie a", "bundesliga",
    "europa league", "ligue europa",
    "coupe de france", "coupe d'europe",
    "score foot", "résultat foot", "classement foot",
    "calendrier foot", "prochaine journée",
    "match foot", "buteur", "but ", "carton rouge", "carton jaune",
    "om ", "marseille", "olympique de marseille",
    "psg", "paris saint germain", "paris saint-germain",
    "ol ", "olympique lyonnais", "lyon",
    "asse", "saint-étienne", "saint etienne",
    "monaco", "as monaco", "lille", "losc",
    "real madrid", "barça", "barcelona", "barcelone",
    "bayern", "bayern munich",
    "man city", "manchester city", "manchester united", "man united",
    "liverpool", "chelsea", "arsenal", "tottenham",
    "juventus", "juve", "inter milan", "ac milan", "napoli",
    "dortmund", "borussia",
    "foot", "football", "soccer"
  ];

  const basketballKeywords = [
    "nba", "euroleague", "euroligue", "basket", "basketball",
    "playoffs nba", "regular season nba", "score nba",
    "lakers", "celtics", "warriors", "bulls", "heat",
    "nets", "knicks", "bucks", "suns", "mavericks",
    "lebron", "curry", "giannis", "doncic", "jokic"
  ];

  const motorsportKeywords = [
    "formule 1", "f1 ", "grand prix", "gp ",
    "classement pilotes", "classement constructeurs",
    "hamilton", "verstappen", "leclerc", "alonso",
    "ferrari", "red bull", "mercedes f1", "mclaren",
    "pole position", "tour de piste", "grille de départ"
  ];

  // Check sports categories (football first as primary sport)
  if (footballKeywords.some(k => queryLower.includes(k))) {
    console.log(`[MARS] Detected sports_football query: "${query.slice(0, 50)}..."`);
    return "sports_football";
  }

  if (basketballKeywords.some(k => queryLower.includes(k))) {
    console.log(`[MARS] Detected sports_basketball query: "${query.slice(0, 50)}..."`);
    return "sports_basketball";
  }

  if (motorsportKeywords.some(k => queryLower.includes(k))) {
    console.log(`[MARS] Detected sports_motorsport query: "${query.slice(0, 50)}..."`);
    return "sports_motorsport";
  }
  
  return "factual";
}

export function evaluateResponsePolicy(
  queryType: QueryType,
  aggregation: FactAggregation,
  sourceScores: ReliabilityScore[],
  freshnessRequired: boolean = false
): PolicyDecision {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const disclaimers: string[] = [];
  
  const highScoreSources = sourceScores.filter(s => s.total >= 60).length;
  const ultraHighScoreSources = sourceScores.filter(s => s.total >= 85).length;
  const verifiedFacts = aggregation.facts.filter(f => f.confidence === "verified").length;
  const probableFacts = aggregation.facts.filter(f => f.confidence === "probable").length;
  
  const hasFreshSources = sourceScores.some(s => 
    s.flags.includes("very_fresh") || s.flags.includes("fresh")
  );
  
  if (queryType === "temporal" || queryType === "news") {
    if (!hasFreshSources) {
      warnings.push("Aucune source fraîche trouvée pour une requête temporelle");
      disclaimers.push("Les données peuvent ne pas être à jour");
    }
  }
  
  if (aggregation.controversies.length > 0) {
    warnings.push(`${aggregation.controversies.length} divergence(s) détectée(s) entre sources`);
    for (const c of aggregation.controversies) {
      disclaimers.push(c);
    }
  }
  
  if (aggregation.dataGaps.length > 0) {
    for (const gap of aggregation.dataGaps) {
      warnings.push(gap);
    }
  }
  
  let canRespond = false;
  let confidenceLevel: PolicyDecision["confidenceLevel"] = "insufficient";
  let reasoning = "";
  
  // STRICT ANTI-APPROXIMATION: For factual, temporal, news - require strong sources
  const isStrictQuery = queryType === "factual" || queryType === "temporal" || queryType === "news";
  
  if (ultraHighScoreSources >= 1 && aggregation.controversies.length === 0) {
    // RULE 1: 1 ultra-reliable source (≥85) with no contradiction = OK
    canRespond = true;
    confidenceLevel = "high";
    reasoning = `Source ultra-fiable (≥85) sans contradiction`;
  }
  else if (highScoreSources >= 2 && verifiedFacts >= 1) {
    // RULE 2: 2+ reliable sources (≥60) with verified facts = OK
    canRespond = true;
    confidenceLevel = "high";
    reasoning = `${highScoreSources} sources fiables, ${verifiedFacts} fait(s) vérifié(s)`;
  }
  else if (highScoreSources >= 2) {
    // 2+ reliable sources but no verified facts = medium confidence
    canRespond = true;
    confidenceLevel = "medium";
    reasoning = `${highScoreSources} sources fiables mais données non recoupées`;
    disclaimers.push("Informations issues de sources fiables mais non confirmées par recoupement");
  }
  else if (!isStrictQuery) {
    // For NON-STRICT queries (opinion, howto, definition) - allow with lower confidence
    if (highScoreSources === 1 && probableFacts >= 1) {
      canRespond = true;
      confidenceLevel = "low";
      reasoning = `Une seule source fiable avec faits probables (requête ${queryType})`;
      disclaimers.push("Information issue d'une source unique - à vérifier");
    } else if (sourceScores.length > 0) {
      canRespond = true;
      confidenceLevel = "low";
      reasoning = `Sources disponibles mais fiabilité insuffisante pour ${queryType}`;
      disclaimers.push("ATTENTION: Données insuffisantes pour une réponse fiable - à vérifier");
      recommendations.push("Rechercher des sources officielles ou de référence");
    } else {
      canRespond = false;
      confidenceLevel = "insufficient";
      reasoning = "Aucune source disponible";
      recommendations.push("Reformuler la requête ou chercher des sources alternatives");
    }
  }
  else {
    // STRICT MODE: factual/temporal/news with insufficient sources = REJECT
    // This enforces: 2+ sources ≥60 OR 1 source ≥85 required
    canRespond = false;
    confidenceLevel = "insufficient";
    if (sourceScores.length === 0) {
      reasoning = "Aucune source disponible";
    } else if (highScoreSources === 0) {
      reasoning = `ANTI-APPROXIMATION: ${sourceScores.length} source(s) trouvée(s) mais aucune fiable (≥60)`;
      disclaimers.push("REFUS DE RÉPONSE: Les sources disponibles n'atteignent pas le seuil de fiabilité requis");
    } else if (highScoreSources === 1) {
      reasoning = `ANTI-APPROXIMATION: Une seule source fiable insuffisante pour requête ${queryType}. Règle: 2+ sources (≥60) ou 1 source ultra-fiable (≥85) requise.`;
      disclaimers.push("REFUS DE RÉPONSE: Une seule source fiable ne suffit pas pour une affirmation factuelle");
    } else {
      reasoning = "Sources insuffisantes pour une réponse factuelle précise";
    }
    recommendations.push("Rechercher des sources officielles ou de référence");
    recommendations.push("Reformuler la requête avec plus de contexte");
  }
  
  if (queryType === "temporal" && !hasFreshSources && canRespond) {
    if (confidenceLevel === "high") {
      confidenceLevel = "medium";
    } else if (confidenceLevel === "medium") {
      confidenceLevel = "low";
    }
    reasoning += " (données potentiellement obsolètes)";
  }
  
  const mustDisclaim = 
    confidenceLevel === "low" || 
    confidenceLevel === "insufficient" ||
    aggregation.controversies.length > 0 ||
    (queryType === "temporal" && !hasFreshSources);
  
  return {
    canRespond,
    confidenceLevel,
    reasoning,
    warnings,
    recommendations,
    mustDisclaim,
    disclaimers
  };
}

export function generateResponseTemplate(decision: PolicyDecision): ResponseTemplate {
  const uncertaintyMarkers: string[] = [];
  
  switch (decision.confidenceLevel) {
    case "high":
      return {
        prefix: "",
        suffix: "",
        uncertaintyMarkers: []
      };
    
    case "medium":
      uncertaintyMarkers.push("selon les sources disponibles");
      return {
        prefix: "",
        suffix: "\n\n_Sources consultées jugées fiables mais données non entièrement recoupées._",
        uncertaintyMarkers
      };
    
    case "low":
      uncertaintyMarkers.push("selon les informations disponibles", "à confirmer");
      return {
        prefix: "⚠️ **Données à vérifier:**\n\n",
        suffix: "\n\n_Les informations ci-dessus proviennent de sources limitées. Il est recommandé de les vérifier auprès de sources officielles._",
        uncertaintyMarkers
      };
    
    case "insufficient":
      return {
        prefix: "❌ **Données insuffisantes pour une réponse fiable:**\n\n",
        suffix: "\n\n_Je ne peux pas fournir une réponse précise sans approximation. Voici ce que j'ai trouvé, mais ces informations ne sont pas suffisamment fiables._",
        uncertaintyMarkers: ["je ne dispose pas de données fiables", "impossible de confirmer"]
      };
  }
}

export function formatPolicyReport(decision: PolicyDecision): string {
  let report = `### Rapport de politique MARS\n\n`;
  report += `**Décision:** ${decision.canRespond ? "Réponse possible" : "Réponse déconseillée"}\n`;
  report += `**Niveau de confiance:** ${decision.confidenceLevel}\n`;
  report += `**Raisonnement:** ${decision.reasoning}\n`;
  
  if (decision.warnings.length > 0) {
    report += `\n**Avertissements:**\n`;
    for (const w of decision.warnings) {
      report += `- ⚠️ ${w}\n`;
    }
  }
  
  if (decision.disclaimers.length > 0) {
    report += `\n**Clauses à mentionner:**\n`;
    for (const d of decision.disclaimers) {
      report += `- ${d}\n`;
    }
  }
  
  if (decision.recommendations.length > 0) {
    report += `\n**Recommandations:**\n`;
    for (const r of decision.recommendations) {
      report += `- 💡 ${r}\n`;
    }
  }
  
  return report;
}

export const responsePolicyService = {
  classifyQuery,
  evaluateResponsePolicy,
  generateResponseTemplate,
  formatPolicyReport
};
