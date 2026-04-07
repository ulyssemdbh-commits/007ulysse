export type ConversationMood = "neutral" | "warm" | "cool" | "energetic" | "calm";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface MoodColors {
  primary: string;
  secondary: string;
  accent: string;
  glow: string;
}

export interface AmbianceColors {
  gradientFrom: string;
  gradientVia: string;
  gradientTo: string;
}

export function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const timeAmbianceMap: Record<TimeOfDay, AmbianceColors> = {
  morning: {
    gradientFrom: "from-amber-50/20",
    gradientVia: "via-orange-100/10",
    gradientTo: "to-yellow-50/5"
  },
  afternoon: {
    gradientFrom: "from-sky-50/20",
    gradientVia: "via-blue-100/10",
    gradientTo: "to-cyan-50/5"
  },
  evening: {
    gradientFrom: "from-orange-100/20",
    gradientVia: "via-rose-100/10",
    gradientTo: "to-purple-100/5"
  },
  night: {
    gradientFrom: "from-indigo-950/30",
    gradientVia: "via-purple-950/20",
    gradientTo: "to-slate-950/10"
  }
};

const moodAmbianceMap: Record<ConversationMood, AmbianceColors> = {
  neutral: {
    gradientFrom: "from-slate-500/10",
    gradientVia: "via-gray-500/5",
    gradientTo: "to-zinc-500/5"
  },
  warm: {
    gradientFrom: "from-amber-500/15",
    gradientVia: "via-orange-500/10",
    gradientTo: "to-yellow-500/5"
  },
  cool: {
    gradientFrom: "from-blue-500/15",
    gradientVia: "via-cyan-500/10",
    gradientTo: "to-sky-500/5"
  },
  energetic: {
    gradientFrom: "from-red-500/15",
    gradientVia: "via-orange-500/10",
    gradientTo: "to-yellow-500/5"
  },
  calm: {
    gradientFrom: "from-violet-500/15",
    gradientVia: "via-purple-500/10",
    gradientTo: "to-indigo-500/5"
  }
};

export function getAmbiance(mood: ConversationMood): { time: AmbianceColors; mood: AmbianceColors; timeOfDay: TimeOfDay } {
  const timeOfDay = getTimeOfDay();
  return {
    time: timeAmbianceMap[timeOfDay],
    mood: moodAmbianceMap[mood],
    timeOfDay
  };
}

export const moodColorMap: Record<ConversationMood, MoodColors> = {
  neutral: {
    primary: "#64748b",
    secondary: "#94a3b8",
    accent: "#cbd5e1",
    glow: "rgba(100, 116, 139, 0.3)"
  },
  warm: {
    primary: "#f59e0b",
    secondary: "#fb923c",
    accent: "#fbbf24",
    glow: "rgba(245, 158, 11, 0.4)"
  },
  cool: {
    primary: "#0ea5e9",
    secondary: "#38bdf8",
    accent: "#7dd3fc",
    glow: "rgba(14, 165, 233, 0.4)"
  },
  energetic: {
    primary: "#ef4444",
    secondary: "#f97316",
    accent: "#fbbf24",
    glow: "rgba(239, 68, 68, 0.4)"
  },
  calm: {
    primary: "#8b5cf6",
    secondary: "#a78bfa",
    accent: "#c4b5fd",
    glow: "rgba(139, 92, 246, 0.4)"
  }
};

const warmKeywords = [
  "super", "genial", "excellent", "bravo", "merci", "content", "heureux", 
  "joie", "rire", "drole", "amusant", "cool", "sympa", "chouette", "top",
  "great", "awesome", "happy", "fun", "love", "amazing", "wonderful",
  "fantastic", "excited", "party", "celebrate", "congratulations",
  "kiff", "kiffer", "adore", "adorable", "magnifique", "parfait", "incroyable",
  "trop bien", "genialissime", "formidable", "extra", "fabuleux", "sublime",
  "canon", "mignon", "cute", "belle", "beau", "bisou", "coeur", "ami", "pote",
  "fete", "vacances", "weekend", "sortie", "soiree", "musique", "danse"
];

const coolKeywords = [
  "serieux", "important", "probleme", "difficile", "urgent", "analyse",
  "strategie", "business", "travail", "projet", "deadline", "objectif",
  "serious", "work", "problem", "issue", "concern", "analysis", "focus",
  "professional", "meeting", "report", "task", "priority", "critical",
  "etude", "examen", "cours", "formation", "entreprise", "client", "budget",
  "finance", "investissement", "carriere", "emploi", "entretien", "contrat",
  "juridique", "legal", "administratif", "obligation", "responsabilite"
];

const energeticKeywords = [
  "vite", "urgent", "maintenant", "action", "go", "allez", "energie",
  "motivation", "sport", "entrainement", "performance", "competition",
  "fast", "quick", "hurry", "now", "rush", "energy", "power", "strong",
  "courir", "course", "gym", "fitness", "muscle", "champion", "victoire",
  "gagner", "defi", "challenge", "objectif", "determination", "fonce",
  "bouge", "active", "dynamique", "intense", "explosif", "puissant"
];

const calmKeywords = [
  "calme", "zen", "tranquille", "repos", "meditation", "relaxation",
  "pause", "respire", "doux", "paisible", "serenite", "harmonie",
  "relax", "peace", "quiet", "rest", "sleep", "gentle", "soft", "breathe",
  "detente", "sieste", "sommeil", "nuit", "etoiles", "nature", "foret",
  "mer", "ocean", "plage", "montagne", "silence", "lentement", "doucement",
  "tranquillement", "serein", "apaise", "repose", "contempler"
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function analyzeMood(messages: Array<{ role: string; content: string }>): ConversationMood {
  if (messages.length === 0) return "neutral";
  
  const recentMessages = messages.slice(-5);
  const text = normalizeText(recentMessages.map(m => m.content).join(" "));
  
  let warmScore = 0;
  let coolScore = 0;
  let energeticScore = 0;
  let calmScore = 0;
  
  warmKeywords.forEach(kw => {
    if (text.includes(kw)) warmScore++;
  });
  
  coolKeywords.forEach(kw => {
    if (text.includes(kw)) coolScore++;
  });
  
  energeticKeywords.forEach(kw => {
    if (text.includes(kw)) energeticScore++;
  });
  
  calmKeywords.forEach(kw => {
    if (text.includes(kw)) calmScore++;
  });
  
  const maxScore = Math.max(warmScore, coolScore, energeticScore, calmScore);
  
  if (maxScore === 0) return "neutral";
  if (warmScore === maxScore) return "warm";
  if (coolScore === maxScore) return "cool";
  if (energeticScore === maxScore) return "energetic";
  if (calmScore === maxScore) return "calm";
  
  return "neutral";
}
