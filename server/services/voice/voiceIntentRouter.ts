/**
 * VOICE INTENT ROUTER V3 PRO
 * 
 * Système intelligent de routage des requêtes vocales vers les handlers spécialisés.
 * Détecte les intentions, extrait les entités, et route vers les bonnes sources de données.
 * 
 * Architecture:
 * 1. Intent Detection (LLM + heuristiques)
 * 2. Entity Extraction (équipes, ligues, dates, etc.)
 * 3. Domain Routing (foot, sugu, weather, calendar, etc.)
 * 4. Response Formatting (style vocal)
 */

import { footdatasService } from "../footdatasService";
import { sportsCacheService } from "../sportsCacheService";
import { matchEndirectService } from "../matchEndirectService";
import { storage } from "../../storage";
import { formatSportsContextForAI, getSportsScreen } from "../sportsScreenContext";
import { 
  resolveReferences, 
  addContextSubject, 
  hasReferencePattern,
  type ContextSubject 
} from "./voiceContextMemory";

// ============== TYPES ==============

export interface VoiceMetadata {
  origin: "voice";
  channel: "talking-v2";
  mode: "continuous" | "push-to-talk";
  userId: number;
  userName?: string;
  persona: "ulysse" | "iris" | "alfred";
  timestamp: number;
}

export type IntentDomain = 
  | "football"
  | "restaurants" 
  | "weather"
  | "calendar"
  | "email"
  | "spotify"
  | "domotique"
  | "memory"
  | "system"
  | "generic";

export interface FootballIntent {
  type: "last_match" | "next_match" | "ranking" | "topscorers" | "player_info" | "team_info" | "live_scores" | "odds";
  team?: string;
  league?: string;
  player?: string;
  date?: string;
}

export interface SuguIntent {
  type: "stock_status" | "daily_report" | "missing_items" | "add_item" | "check_item";
  restaurant?: "suguval" | "sugumaillane";
  item?: string;
}

export interface SystemIntent {
  type: "change_mode" | "mute" | "unmute" | "end_call" | "volume_up" | "volume_down" | "repeat";
}

export interface DetectedIntent {
  domain: IntentDomain;
  confidence: number;
  football?: FootballIntent;
  sugu?: SuguIntent;
  system?: SystemIntent;
  rawQuery: string;
  entities: Record<string, string>;
}

export interface VoiceResponse {
  text: string;
  domain: IntentDomain;
  dataSources: string[];
  success: boolean;
  action?: {
    type: string;
    data: any;
    uiAction?: string;
  };
}

// ============== PATTERNS & HEURISTIQUES ==============

const FOOTBALL_PATTERNS = {
  lastMatch: [
    /(?:dernier|précédent|hier|récent)\s*(?:match|rencontre|résultat)/i,
    /(?:score|résultat)\s*(?:du|de|d')\s*(?:dernier|hier)/i,
    /comment\s*(?:s'est|a)\s*(?:passé|joué|terminé)/i,
    /(?:gagné|perdu|match nul)\s*(?:contre|face)/i,
  ],
  nextMatch: [
    /(?:prochain|suivant|demain|ce soir|aujourd'hui)\s*(?:match|rencontre)/i,
    /(?:quand|à quelle heure)\s*(?:joue|affronte)/i,
    /(?:joue|affronte)\s*(?:quand|demain|ce soir)/i,
    /(?:calendrier|programme|agenda)\s*(?:de|du|des)/i,
  ],
  ranking: [
    /(?:classement|position|rang|place)/i,
    /(?:qui est|c'est qui)\s*(?:premier|deuxième|troisième|\d+(?:e|ème|er))/i,
    /(?:combien de points|nombre de points)/i,
    /(?:leader|en tête)/i,
  ],
  topscorers: [
    /(?:meilleur|top)\s*(?:buteur|buteurs|scoreur)/i,
    /(?:qui a marqué|qui marque)\s*(?:le plus|beaucoup)/i,
    /(?:classement des buteurs|nombre de buts)/i,
  ],
  liveScores: [
    /(?:score|résultat)\s*(?:en cours|live|en direct|actuel)/i,
    /(?:match|matchs)\s*(?:en cours|live|en direct)/i,
    /(?:ça se passe|c'est quoi le score)/i,
  ],
  odds: [
    /(?:cote|cotes|pronostic|prédiction|pari)/i,
    /(?:qui va gagner|favori)/i,
    /(?:chances de|probabilité)/i,
  ],
};

const SUGU_PATTERNS = [
  /(?:suguval|sugumaillane|restaurant|stock|inventaire|courses)/i,
  /(?:rupture|manque|en panne|à acheter)/i,
  /(?:combien de|niveau de stock)/i,
  /(?:rapport|résumé)\s*(?:du jour|journalier|quotidien)/i,
];

const WEATHER_PATTERNS = [
  /(?:météo|temps|température|pluie|soleil|nuage)/i,
  /(?:il fait|quel temps|il pleut|il neige)/i,
  /(?:chaud|froid|doux|humide)/i,
];

const CALENDAR_PATTERNS = [
  /(?:rendez-vous|rdv|réunion|meeting|agenda)/i,
  /(?:qu'est-ce que j'ai|c'est quoi mon planning)/i,
  /(?:programme|emploi du temps)/i,
];

const SYSTEM_PATTERNS = {
  changeMode: [/(?:change|passe)\s*(?:en|de)\s*mode/i, /mode\s*(?:focus|conversation|expert)/i],
  mute: [/(?:mets-toi|passe)\s*(?:en|en mode)\s*(?:sourdine|muet|silence)/i, /tais-toi/i],
  unmute: [/(?:parle|réactive|réactiver)\s*(?:le son|la voix)/i],
  endCall: [/(?:raccroche|termine|fin|arrête)\s*(?:l'appel|la conversation)/i, /au revoir/i, /à plus/i],
  repeat: [/(?:répète|redis|redit|tu peux répéter)/i, /(?:j'ai pas|pas compris|entendu)/i],
};

// ============== TEAM & LEAGUE MAPPINGS ==============

const TEAM_ALIASES: Record<string, string> = {
  // Ligue 1
  "om": "Olympique de Marseille",
  "marseille": "Olympique de Marseille",
  "olympique marseille": "Olympique de Marseille",
  "psg": "Paris Saint-Germain",
  "paris": "Paris Saint-Germain",
  "ol": "Olympique Lyonnais",
  "lyon": "Olympique Lyonnais",
  "monaco": "AS Monaco",
  "asm": "AS Monaco",
  "lille": "LOSC Lille",
  "losc": "LOSC Lille",
  "lens": "RC Lens",
  "rennes": "Stade Rennais",
  "nice": "OGC Nice",
  "nantes": "FC Nantes",
  "strasbourg": "RC Strasbourg",
  "montpellier": "Montpellier HSC",
  "brest": "Stade Brestois",
  "reims": "Stade de Reims",
  "toulouse": "Toulouse FC",
  "auxerre": "AJ Auxerre",
  "angers": "Angers SCO",
  "le havre": "Le Havre AC",
  "saint-etienne": "AS Saint-Étienne",
  "asse": "AS Saint-Étienne",
  
  // Premier League
  "manchester united": "Manchester United",
  "man united": "Manchester United",
  "mu": "Manchester United",
  "manchester city": "Manchester City",
  "man city": "Manchester City",
  "city": "Manchester City",
  "liverpool": "Liverpool FC",
  "arsenal": "Arsenal FC",
  "chelsea": "Chelsea FC",
  "tottenham": "Tottenham Hotspur",
  "spurs": "Tottenham Hotspur",
  
  // La Liga
  "real": "Real Madrid",
  "real madrid": "Real Madrid",
  "barça": "FC Barcelona",
  "barcelona": "FC Barcelona",
  "barcelone": "FC Barcelona",
  "atletico": "Atlético Madrid",
  "atletico madrid": "Atlético Madrid",
  
  // Bundesliga
  "bayern": "Bayern Munich",
  "bayern munich": "Bayern Munich",
  "dortmund": "Borussia Dortmund",
  "bvb": "Borussia Dortmund",
  
  // Serie A
  "juve": "Juventus",
  "juventus": "Juventus",
  "inter": "Inter Milan",
  "inter milan": "Inter Milan",
  "milan": "AC Milan",
  "ac milan": "AC Milan",
  "napoli": "SSC Napoli",
  "naples": "SSC Napoli",
  "roma": "AS Roma",
  "rome": "AS Roma",
};

const LEAGUE_ALIASES: Record<string, string> = {
  "ligue 1": "L1",
  "l1": "L1",
  "ligue un": "L1",
  "championnat de france": "L1",
  "premier league": "PL",
  "pl": "PL",
  "angleterre": "PL",
  "liga": "LL",
  "la liga": "LL",
  "espagne": "LL",
  "bundesliga": "BL",
  "bl": "BL",
  "allemagne": "BL",
  "serie a": "SA",
  "sa": "SA",
  "italie": "SA",
  "calcio": "SA",
  "champions league": "CL",
  "ldc": "CL",
  "cl": "CL",
};

// ============== INTENT DETECTION ==============

export function detectIntent(userMessage: string): DetectedIntent {
  const message = userMessage.toLowerCase().trim();
  const entities: Record<string, string> = {};
  
  // 1. Extract team
  for (const [alias, fullName] of Object.entries(TEAM_ALIASES)) {
    if (message.includes(alias)) {
      entities.team = fullName;
      break;
    }
  }
  
  // 2. Extract league
  for (const [alias, code] of Object.entries(LEAGUE_ALIASES)) {
    if (message.includes(alias)) {
      entities.league = code;
      break;
    }
  }
  
  // 3. Detect domain and intent type
  
  // System commands (highest priority)
  for (const [type, patterns] of Object.entries(SYSTEM_PATTERNS)) {
    if (patterns.some(p => p.test(message))) {
      return {
        domain: "system",
        confidence: 0.95,
        system: { type: type as SystemIntent["type"] },
        rawQuery: userMessage,
        entities,
      };
    }
  }
  
  // Football
  for (const [type, patterns] of Object.entries(FOOTBALL_PATTERNS)) {
    if (patterns.some(p => p.test(message))) {
      const footballIntent: FootballIntent = {
        type: type as FootballIntent["type"],
        team: entities.team,
        league: entities.league,
      };
      
      return {
        domain: "football",
        confidence: entities.team || entities.league ? 0.9 : 0.7,
        football: footballIntent,
        rawQuery: userMessage,
        entities,
      };
    }
  }
  
  // Also detect football by team/league mention even without explicit patterns
  if (entities.team || entities.league) {
    return {
      domain: "football",
      confidence: 0.6,
      football: { type: "team_info", team: entities.team, league: entities.league },
      rawQuery: userMessage,
      entities,
    };
  }
  
  // Sugu (restaurants)
  if (SUGU_PATTERNS.some(p => p.test(message))) {
    const restaurant = message.includes("maillane") || message.includes("sugumaillane") 
      ? "sugumaillane" 
      : "suguval";
    
    let type: SuguIntent["type"] = "stock_status";
    if (/rapport|résumé|journalier/.test(message)) type = "daily_report";
    if (/rupture|manque|à acheter/.test(message)) type = "missing_items";
    
    return {
      domain: "restaurants",
      confidence: 0.85,
      sugu: { type, restaurant },
      rawQuery: userMessage,
      entities,
    };
  }
  
  // Weather
  if (WEATHER_PATTERNS.some(p => p.test(message))) {
    return {
      domain: "weather",
      confidence: 0.8,
      rawQuery: userMessage,
      entities,
    };
  }
  
  // Calendar
  if (CALENDAR_PATTERNS.some(p => p.test(message))) {
    return {
      domain: "calendar",
      confidence: 0.8,
      rawQuery: userMessage,
      entities,
    };
  }
  
  // Generic fallback
  return {
    domain: "generic",
    confidence: 0.5,
    rawQuery: userMessage,
    entities,
  };
}

// ============== DOMAIN HANDLERS ==============

export async function handleFootballIntent(intent: FootballIntent, userId: number): Promise<VoiceResponse> {
  const dataSources: string[] = [];
  
  try {
    switch (intent.type) {
      case "last_match": {
        if (!intent.team) {
          return {
            text: "De quelle équipe tu veux connaître le dernier match ?",
            domain: "football",
            dataSources: [],
            success: false,
          };
        }
        
        // 1. Try footdatas
        try {
          const clubInfo = await footdatasService.getClubInfo(intent.team);
          if (clubInfo?.stats?.lastMatches?.[0]) {
            dataSources.push("footdatas");
            const match = clubInfo.stats.lastMatches[0];
            return {
              text: formatLastMatchVoice(intent.team, match),
              domain: "football",
              dataSources,
              success: true,
            };
          }
        } catch (e) {
          console.log("[VoiceIntent] footdatas not available:", e);
        }
        
        // 2. Try sports cache
        try {
          const cachedMatches = await sportsCacheService.getRecentMatches(intent.team);
          if (cachedMatches?.length > 0) {
            dataSources.push("sports_cache");
            const match = cachedMatches[0];
            return {
              text: formatLastMatchVoice(intent.team, match),
              domain: "football",
              dataSources,
              success: true,
            };
          }
        } catch (e) {
          console.log("[VoiceIntent] sports_cache not available:", e);
        }
        
        // 3. Try matchendirect
        try {
          const liveData = await matchEndirectService.getMatchesByDate(new Date());
          const teamMatch = liveData?.find((m: any) => 
            m.homeTeam?.toLowerCase().includes(intent.team!.toLowerCase()) ||
            m.awayTeam?.toLowerCase().includes(intent.team!.toLowerCase())
          );
          if (teamMatch) {
            dataSources.push("matchendirect");
            return {
              text: formatLastMatchVoice(intent.team, teamMatch),
              domain: "football",
              dataSources,
              success: true,
            };
          }
        } catch (e) {
          console.log("[VoiceIntent] matchendirect not available:", e);
        }
        
        return {
          text: `Je n'ai pas trouvé de match récent pour ${intent.team}. Mes données peuvent être incomplètes.`,
          domain: "football",
          dataSources,
          success: false,
        };
      }
      
      case "next_match": {
        if (!intent.team) {
          return {
            text: "Quelle équipe t'intéresse pour le prochain match ?",
            domain: "football",
            dataSources: [],
            success: false,
          };
        }
        
        // Try matchendirect for upcoming matches
        try {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 7); // Next 7 days
          
          const upcomingMatches = await matchEndirectService.getMatchesByDateRange(new Date(), tomorrow);
          const teamMatch = upcomingMatches?.find((m: any) =>
            m.homeTeam?.toLowerCase().includes(intent.team!.toLowerCase()) ||
            m.awayTeam?.toLowerCase().includes(intent.team!.toLowerCase())
          );
          
          if (teamMatch) {
            dataSources.push("matchendirect");
            return {
              text: formatNextMatchVoice(intent.team, teamMatch),
              domain: "football",
              dataSources,
              success: true,
            };
          }
        } catch (e) {
          console.log("[VoiceIntent] matchendirect not available for upcoming:", e);
        }
        
        return {
          text: `Je n'ai pas trouvé le prochain match de ${intent.team} dans les 7 prochains jours.`,
          domain: "football",
          dataSources,
          success: false,
        };
      }
      
      case "ranking": {
        const leagueCode = intent.league || "L1";
        
        try {
          const ranking = await footdatasService.getRankings(leagueCode);
          if (ranking?.length > 0) {
            dataSources.push("footdatas");
            return {
              text: formatRankingVoice(leagueCode, ranking.slice(0, 5)),
              domain: "football",
              dataSources,
              success: true,
              action: {
                type: "display_ranking",
                data: { league: leagueCode, ranking },
                uiAction: "show_ranking_modal",
              },
            };
          }
        } catch (e) {
          console.log("[VoiceIntent] footdatas ranking not available:", e);
        }
        
        return {
          text: `Je n'ai pas le classement actuel de ${getLeagueName(leagueCode)}.`,
          domain: "football",
          dataSources,
          success: false,
        };
      }
      
      case "topscorers": {
        const leagueCode = intent.league || "L1";
        
        try {
          const scorers = await footdatasService.getTopScorers(leagueCode);
          if (scorers?.length > 0) {
            dataSources.push("footdatas");
            return {
              text: formatTopscorersVoice(leagueCode, scorers.slice(0, 5)),
              domain: "football",
              dataSources,
              success: true,
              action: {
                type: "display_topscorers",
                data: { league: leagueCode, scorers: scorers.slice(0, 10) },
                uiAction: "show_topscorers_modal",
              },
            };
          }
        } catch (e) {
          console.log("[VoiceIntent] topscorers not available:", e);
        }
        
        return {
          text: `Je n'ai pas le classement des buteurs de ${getLeagueName(leagueCode)}.`,
          domain: "football",
          dataSources,
          success: false,
        };
      }
      
      case "live_scores": {
        try {
          const liveMatches = await matchEndirectService.getLiveMatches();
          if (liveMatches?.length > 0) {
            dataSources.push("matchendirect");
            return {
              text: formatLiveScoresVoice(liveMatches),
              domain: "football",
              dataSources,
              success: true,
              action: {
                type: "display_live_scores",
                data: { matches: liveMatches },
                uiAction: "show_live_scores_overlay",
              },
            };
          }
        } catch (e) {
          console.log("[VoiceIntent] live matches not available:", e);
        }
        
        return {
          text: "Il n'y a pas de match en cours pour le moment.",
          domain: "football",
          dataSources,
          success: false,
        };
      }
      
      case "odds": {
        if (!intent.team) {
          return {
            text: "Pour quel match tu veux les cotes ?",
            domain: "football",
            dataSources: [],
            success: false,
          };
        }
        
        try {
          const odds = await sportsCacheService.getOddsForTeam(intent.team);
          if (odds) {
            dataSources.push("sports_cache");
            return {
              text: formatOddsVoice(intent.team, odds),
              domain: "football",
              dataSources,
              success: true,
              action: {
                type: "display_odds",
                data: { team: intent.team, odds },
                uiAction: "show_odds_card",
              },
            };
          }
        } catch (e) {
          console.log("[VoiceIntent] odds not available:", e);
        }
        
        return {
          text: `Je n'ai pas de cotes disponibles pour ${intent.team}.`,
          domain: "football",
          dataSources,
          success: false,
        };
      }
      
      case "team_info":
      default: {
        if (intent.team) {
          try {
            const clubInfo = await footdatasService.getClubInfo(intent.team);
            if (clubInfo) {
              dataSources.push("footdatas");
              return {
                text: formatTeamInfoVoice(clubInfo),
                domain: "football",
                dataSources,
                success: true,
              };
            }
          } catch (e) {
            console.log("[VoiceIntent] team info not available:", e);
          }
        }
        
        return {
          text: "Je n'ai pas compris ta question foot. Tu peux me demander un score, un classement, ou le prochain match d'une équipe.",
          domain: "football",
          dataSources,
          success: false,
        };
      }
    }
  } catch (error) {
    console.error("[VoiceIntent] Football handler error:", error);
    return {
      text: "J'ai eu un problème pour récupérer les infos foot. Réessaie dans un moment.",
      domain: "football",
      dataSources,
      success: false,
    };
  }
}

export async function handleSuguIntent(intent: SuguIntent, userId: number): Promise<VoiceResponse> {
  const dataSources: string[] = [];
  const restaurantName = intent.restaurant === "sugumaillane" ? "Sugumaillane" : "Suguval";
  
  try {
    switch (intent.type) {
      case "stock_status": {
        dataSources.push(intent.restaurant || "suguval");
        
        // Get items from database
        const items = await storage.getChecklistItems(userId, intent.restaurant || "suguval");
        const lowStock = items.filter(i => i.quantity === 0 || i.status === "critical");
        
        if (lowStock.length === 0) {
          return {
            text: `Tout est bon niveau stock chez ${restaurantName}. Rien à signaler.`,
            domain: "restaurants",
            dataSources,
            success: true,
          };
        }
        
        const itemNames = lowStock.slice(0, 5).map(i => i.name).join(", ");
        return {
          text: `Chez ${restaurantName}, ${lowStock.length} articles en rupture ou niveau critique : ${itemNames}.`,
          domain: "restaurants",
          dataSources,
          success: true,
        };
      }
      
      case "missing_items": {
        dataSources.push(intent.restaurant || "suguval");
        
        const items = await storage.getChecklistItems(userId, intent.restaurant || "suguval");
        const missing = items.filter(i => i.quantity === 0);
        
        if (missing.length === 0) {
          return {
            text: `Pas de rupture de stock chez ${restaurantName}.`,
            domain: "restaurants",
            dataSources,
            success: true,
          };
        }
        
        const itemNames = missing.slice(0, 5).map(i => i.name).join(", ");
        return {
          text: `Il manque ${missing.length} articles chez ${restaurantName} : ${itemNames}.`,
          domain: "restaurants",
          dataSources,
          success: true,
        };
      }
      
      case "daily_report": {
        dataSources.push(intent.restaurant || "suguval");
        
        const items = await storage.getChecklistItems(userId, intent.restaurant || "suguval");
        const checked = items.filter(i => i.isChecked).length;
        const total = items.length;
        const critical = items.filter(i => i.status === "critical").length;
        
        return {
          text: `Rapport ${restaurantName} : ${checked} sur ${total} articles vérifiés. ${critical} en situation critique.`,
          domain: "restaurants",
          dataSources,
          success: true,
        };
      }
      
      default:
        return {
          text: `Que veux-tu savoir sur ${restaurantName} ? Stock, ruptures, ou rapport du jour ?`,
          domain: "restaurants",
          dataSources,
          success: false,
        };
    }
  } catch (error) {
    console.error("[VoiceIntent] Sugu handler error:", error);
    return {
      text: `J'ai eu un problème pour accéder aux données de ${restaurantName}.`,
      domain: "restaurants",
      dataSources: [],
      success: false,
    };
  }
}

export function handleSystemIntent(intent: SystemIntent): VoiceResponse {
  switch (intent.type) {
    case "mute":
      return {
        text: "OK, je me mets en sourdine.",
        domain: "system",
        dataSources: [],
        success: true,
        action: { type: "mute", data: {}, uiAction: "mute" },
      };
    
    case "unmute":
      return {
        text: "Je suis de retour.",
        domain: "system",
        dataSources: [],
        success: true,
        action: { type: "unmute", data: {}, uiAction: "unmute" },
      };
    
    case "end_call":
      return {
        text: "À plus tard !",
        domain: "system",
        dataSources: [],
        success: true,
        action: { type: "end_call", data: {}, uiAction: "endCall" },
      };
    
    case "change_mode":
      return {
        text: "Mode changé.",
        domain: "system",
        dataSources: [],
        success: true,
        action: { type: "change_mode", data: {}, uiAction: "toggleMode" },
      };
    
    case "repeat":
      return {
        text: "",
        domain: "system",
        dataSources: [],
        success: true,
        action: { type: "repeat", data: {}, uiAction: "repeat" },
      };
    
    default:
      return {
        text: "Commande non reconnue.",
        domain: "system",
        dataSources: [],
        success: false,
      };
  }
}

// ============== VOICE FORMATTERS ==============

function formatLastMatchVoice(team: string, match: any): string {
  const opponent = match.homeTeam === team ? match.awayTeam : match.homeTeam;
  const isHome = match.homeTeam === team;
  const homeScore = match.homeScore ?? match.score?.home ?? "?";
  const awayScore = match.awayScore ?? match.score?.away ?? "?";
  const teamScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;
  
  let result = "match nul";
  if (teamScore > oppScore) result = "victoire";
  else if (teamScore < oppScore) result = "défaite";
  
  const venue = isHome ? "à domicile" : "à l'extérieur";
  
  return `Le dernier match de ${team}, c'était ${result} ${teamScore} à ${oppScore} contre ${opponent} ${venue}.`;
}

function formatNextMatchVoice(team: string, match: any): string {
  const opponent = match.homeTeam === team ? match.awayTeam : match.homeTeam;
  const isHome = match.homeTeam === team;
  const venue = isHome ? "à domicile" : "à l'extérieur";
  
  const date = match.date ? new Date(match.date) : null;
  let dateStr = "";
  if (date) {
    const days = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    dateStr = `${days[date.getDay()]} à ${date.getHours()}h${date.getMinutes().toString().padStart(2, '0')}`;
  }
  
  return `Le prochain match de ${team}, c'est ${dateStr} contre ${opponent} ${venue}.`;
}

function formatRankingVoice(leagueCode: string, ranking: any[]): string {
  const leagueName = getLeagueName(leagueCode);
  const top3 = ranking.slice(0, 3).map((t, i) => 
    `${i + 1}er ${t.name || t.team} avec ${t.points} points`
  ).join(", ");
  
  return `Classement ${leagueName} : ${top3}.`;
}

function formatTopscorersVoice(leagueCode: string, scorers: any[]): string {
  const leagueName = getLeagueName(leagueCode);
  const top3 = scorers.slice(0, 3).map((s, i) => 
    `${s.name} ${s.goals} buts`
  ).join(", ");
  
  return `Meilleurs buteurs ${leagueName} : ${top3}.`;
}

function formatLiveScoresVoice(matches: any[]): string {
  if (matches.length === 0) return "Pas de match en cours.";
  
  const summaries = matches.slice(0, 3).map(m => 
    `${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam}`
  ).join(", ");
  
  return `Scores en direct : ${summaries}.`;
}

function formatOddsVoice(team: string, odds: any): string {
  const homeOdds = odds.home || odds.homeWin || "?";
  const drawOdds = odds.draw || "?";
  const awayOdds = odds.away || odds.awayWin || "?";
  
  return `Cotes pour ${team} : victoire ${homeOdds}, nul ${drawOdds}, défaite ${awayOdds}.`;
}

function formatTeamInfoVoice(club: any): string {
  const position = club.ranking?.position || "?";
  const points = club.ranking?.points || "?";
  const league = club.league || "son championnat";
  
  return `${club.name} est actuellement ${position}ème de ${league} avec ${points} points.`;
}

function getLeagueName(code: string): string {
  const names: Record<string, string> = {
    "L1": "Ligue 1",
    "PL": "Premier League",
    "LL": "La Liga",
    "BL": "Bundesliga",
    "SA": "Serie A",
    "CL": "Champions League",
  };
  return names[code] || code;
}

// ============== MAIN ROUTER ==============

export async function routeVoiceRequest(
  userMessage: string, 
  metadata: VoiceMetadata
): Promise<VoiceResponse | null> {
  console.log(`[VoiceRouter] Processing: "${userMessage.substring(0, 50)}..." from ${metadata.userName}`);
  
  // === PHASE 1: Context Resolution ===
  // Resolve references like "et le prochain ?" using conversation memory
  let resolvedMessage = userMessage;
  let usedContext: ContextSubject | null = null;
  
  if (hasReferencePattern(userMessage)) {
    const resolved = resolveReferences(metadata.userId, userMessage);
    resolvedMessage = resolved.resolvedMessage;
    usedContext = resolved.usedContext;
    
    if (resolvedMessage !== userMessage) {
      console.log(`[VoiceRouter] Context resolved: "${userMessage}" → "${resolvedMessage}"`);
    }
  }
  
  // === PHASE 1.5: Screen Context Awareness ===
  const screenPatterns = [
    /(?:sur (?:mon |l')?écran|ce que (?:je )?(?:regarde|vois)|(?:le |ce )?match (?:affiché|sélectionné))/i,
    /(?:les? pronos?(?:tics?)? (?:affichés?|sur l'écran|là)|qu'est-ce (?:que )?tu (?:vois|penses))/i,
    /(?:analyse (?:ça|ce match|ces matchs)|ton avis (?:sur |là-dessus)|ta stratégie)/i,
    /(?:le combiné|la cote|les cotes|le classement) (?:affiché|là|sur l'écran)/i,
  ];
  const isScreenQuestion = screenPatterns.some(p => p.test(userMessage));
  const screenState = getSportsScreen(metadata.userId);
  
  if (isScreenQuestion && screenState) {
    const screenCtx = formatSportsContextForAI(metadata.userId);
    if (screenCtx) {
      console.log(`[VoiceRouter] Screen context detected, enriching with live sports view`);
      resolvedMessage = `${resolvedMessage}\n\n${screenCtx}`;
    }
  }

  // === PHASE 2: Intent Detection ===
  const intent = detectIntent(resolvedMessage);
  console.log(`[VoiceRouter] Detected intent:`, { 
    domain: intent.domain, 
    confidence: intent.confidence,
    entities: intent.entities,
    usedContext: usedContext?.entity 
  });
  
  // If screen question about sports but no football intent detected, force football domain
  if (isScreenQuestion && screenState && intent.domain !== "football" && intent.confidence < 0.6) {
    console.log(`[VoiceRouter] Screen question detected with sports context, routing to LLM with screen context`);
    return null;
  }

  // Only route if confidence is high enough
  if (intent.confidence < 0.6) {
    console.log(`[VoiceRouter] Low confidence (${intent.confidence}), falling back to LLM`);
    return null; // Let LLM handle it
  }
  
  // === PHASE 3: Domain Routing ===
  let response: VoiceResponse | null = null;
  
  switch (intent.domain) {
    case "football":
      if (intent.football) {
        response = await handleFootballIntent(intent.football, metadata.userId);
        
        // Store context for future reference resolution
        if (response?.success && intent.entities.team) {
          addContextSubject(metadata.userId, {
            domain: "football",
            type: intent.football.type,
            entity: intent.entities.team,
            entityType: "team",
            metadata: { lastIntent: intent.football.type },
          });
        }
        if (response?.success && intent.entities.league) {
          addContextSubject(metadata.userId, {
            domain: "football",
            type: intent.football.type,
            entity: intent.entities.league,
            entityType: "league",
            metadata: { lastIntent: intent.football.type },
          });
        }
      }
      break;
    
    case "restaurants":
      if (intent.sugu) {
        response = await handleSuguIntent(intent.sugu, metadata.userId);
        
        // Store restaurant context
        if (response?.success && intent.sugu.restaurant) {
          addContextSubject(metadata.userId, {
            domain: "restaurants",
            type: intent.sugu.type,
            entity: intent.sugu.restaurant,
            entityType: "restaurant",
          });
        }
      }
      break;
    
    case "system":
      if (intent.system) {
        response = handleSystemIntent(intent.system);
      }
      break;
    
    case "weather":
    case "calendar":
    case "email":
    case "spotify":
    case "domotique":
      // These will fall through to LLM with action detection
      console.log(`[VoiceRouter] Domain ${intent.domain} needs full Ulysse system`);
      return null;
    
    default:
      return null;
  }
  
  if (response) {
    console.log(`[VoiceRouter] Response generated:`, { 
      domain: response.domain, 
      dataSources: response.dataSources,
      success: response.success 
    });
  }
  
  return response;
}

// ============== VOICE SESSION LOGGING ==============

export interface VoiceSessionLog {
  channel: string;
  userId: number;
  userName?: string;
  text: string;
  intent: string;
  domain: IntentDomain;
  dataSources: string[];
  latencyMs: number;
  success: boolean;
  timestamp: Date;
}

const voiceSessionLogs: VoiceSessionLog[] = [];

export function logVoiceSession(log: VoiceSessionLog): void {
  voiceSessionLogs.push(log);
  
  // Keep only last 1000 logs in memory
  if (voiceSessionLogs.length > 1000) {
    voiceSessionLogs.shift();
  }
  
  console.log(`[VoiceSession] ${log.domain}:${log.intent} | ${log.latencyMs}ms | ${log.success ? "✓" : "✗"} | sources: ${log.dataSources.join(",")}`);
}

export function getVoiceSessionStats(): {
  totalSessions: number;
  successRate: number;
  avgLatency: number;
  byDomain: Record<string, { count: number; successRate: number }>;
} {
  const total = voiceSessionLogs.length;
  if (total === 0) {
    return { totalSessions: 0, successRate: 0, avgLatency: 0, byDomain: {} };
  }
  
  const successful = voiceSessionLogs.filter(l => l.success).length;
  const totalLatency = voiceSessionLogs.reduce((sum, l) => sum + l.latencyMs, 0);
  
  const byDomain: Record<string, { count: number; successRate: number }> = {};
  for (const log of voiceSessionLogs) {
    if (!byDomain[log.domain]) {
      byDomain[log.domain] = { count: 0, successRate: 0 };
    }
    byDomain[log.domain].count++;
  }
  
  for (const domain of Object.keys(byDomain)) {
    const domainLogs = voiceSessionLogs.filter(l => l.domain === domain);
    const domainSuccess = domainLogs.filter(l => l.success).length;
    byDomain[domain].successRate = domainSuccess / domainLogs.length;
  }
  
  return {
    totalSessions: total,
    successRate: successful / total,
    avgLatency: totalLatency / total,
    byDomain,
  };
}
