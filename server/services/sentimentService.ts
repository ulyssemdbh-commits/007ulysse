export type Mood = 'stressed' | 'rushed' | 'relaxed' | 'happy' | 'frustrated' | 'neutral';

export interface SentimentResult {
  mood: Mood;
  confidence: number;
  indicators: string[];
}

interface SentimentHistoryEntry {
  userId: number;
  mood: Mood;
  confidence: number;
  timestamp: number;
  messageExcerpt: string;
}

const MOOD_PATTERNS: Record<Mood, { keywords: RegExp[]; weight: number }> = {
  stressed: {
    keywords: [
      /\b(stress[eé]?|anxieu[sx]?|angoiss[eé]?|paniqu[eé]?|inquiet|inqui[eè]te|nerveu[sx]?|tendu|overwhelm|panick?)\b/i,
      /\b(urgent|urgemment|vite|deadline|retard|en retard|pas le temps|trop de|overflow|surcharg[eé])\b/i,
      /\b(je n'y arrive pas|je sais pas quoi faire|c'est trop|je suis perdu|au secours|help|sos)\b/i,
      /\b(pression|sous pression|craquer|p[eé]ter un c[aâ]ble|burn.?out)\b/i,
    ],
    weight: 1.0,
  },
  rushed: {
    keywords: [
      /\b(vite|rapide|rapidement|d[eé]p[eê]che|faut que|il faut|asap|tout de suite|maintenant|imm[eé]diatement)\b/i,
      /\b(press[eé]|en vitesse|en coup de vent|pas le temps|court|bref|fais court|r[eé]sum[eé])\b/i,
      /\b(quick|fast|hurry|rush|now|immediately)\b/i,
      /^.{1,15}[?]$/,
    ],
    weight: 0.8,
  },
  frustrated: {
    keywords: [
      /\b(putain|merde|bordel|fait chier|ras le bol|[eé]nerv[eé]|agac[eé]|[eé]c[oœ]ur[eé]|insupportable)\b/i,
      /\b(encore|toujours pas|ça marche pas|ça fonctionne pas|bug|cass[eé]|nul|d[eé]bile|ridicule)\b/i,
      /\b(j'en ai marre|j'en peux plus|c'est nul|arr[eê]te|stop|damn|wtf|ffs|shit|fuck)\b/i,
      /\b(incomp[eé]tent|inutile|impossible|n'importe quoi)\b/i,
      /!!+/,
    ],
    weight: 1.0,
  },
  happy: {
    keywords: [
      /\b(super|g[eé]nial|excellent|parfait|top|bravo|merci|cool|nice|awesome|great|amazing|love)\b/i,
      /\b(content|heureu[sx]?|ravi|enchant[eé]|satisfait|f[eê]te|c[eé]l[eé]br|j'adore|trop bien)\b/i,
      /\b(magnifique|formidable|incroyable|extraordinaire|fantastique|yes|yay|woohoo)\b/i,
      /\b(bonne nouvelle|beau|belle|r[eé]ussi|victoire|gagn[eé]|won|win)\b/i,
    ],
    weight: 0.9,
  },
  relaxed: {
    keywords: [
      /\b(tranquille|relax|cool|zen|chill|d[eé]tendu|posé|serein|calme|peace|peaceful)\b/i,
      /\b(pas press[eé]|prends? ton temps|quand tu peux|no rush|pas urgent)\b/i,
      /\b(à l'aise|confortable|bien|ça va|tout va bien|nickel|impeccable)\b/i,
    ],
    weight: 0.7,
  },
  neutral: {
    keywords: [],
    weight: 0.5,
  },
};

const sentimentHistory: SentimentHistoryEntry[] = [];
const MAX_HISTORY = 2000;

export function detectSentiment(text: string): SentimentResult {
  const scores: Record<Mood, { score: number; indicators: string[] }> = {
    stressed: { score: 0, indicators: [] },
    rushed: { score: 0, indicators: [] },
    relaxed: { score: 0, indicators: [] },
    happy: { score: 0, indicators: [] },
    frustrated: { score: 0, indicators: [] },
    neutral: { score: 0, indicators: [] },
  };

  const cleaned = text.trim();
  if (cleaned.length < 3) {
    return { mood: 'neutral', confidence: 0.5, indicators: [] };
  }

  for (const [mood, config] of Object.entries(MOOD_PATTERNS) as [Mood, typeof MOOD_PATTERNS[Mood]][]) {
    for (const pattern of config.keywords) {
      const matches = cleaned.match(pattern);
      if (matches) {
        scores[mood].score += config.weight;
        scores[mood].indicators.push(matches[0]);
      }
    }
  }

  const allCaps = cleaned.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  if (allCaps.length > 5 && allCaps === allCaps.toUpperCase()) {
    scores.frustrated.score += 0.5;
    scores.frustrated.indicators.push('ALL_CAPS');
    scores.stressed.score += 0.3;
  }

  const exclamationCount = (cleaned.match(/!/g) || []).length;
  if (exclamationCount >= 3) {
    scores.frustrated.score += 0.3;
    scores.frustrated.indicators.push('multiple_exclamations');
  }

  const questionCount = (cleaned.match(/\?/g) || []).length;
  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount <= 5 && questionCount > 0) {
    scores.rushed.score += 0.3;
    scores.rushed.indicators.push('short_question');
  }

  if (/\.{3,}|…/.test(cleaned)) {
    scores.stressed.score += 0.2;
    scores.stressed.indicators.push('ellipsis');
  }

  let bestMood: Mood = 'neutral';
  let bestScore = 0;
  for (const [mood, data] of Object.entries(scores) as [Mood, typeof scores[Mood]][]) {
    if (data.score > bestScore) {
      bestScore = data.score;
      bestMood = mood;
    }
  }

  const confidence = bestScore > 0
    ? Math.min(0.95, 0.5 + bestScore * 0.2)
    : 0.5;

  return {
    mood: bestMood,
    confidence,
    indicators: scores[bestMood].indicators,
  };
}

export function recordSentiment(userId: number, result: SentimentResult, messageExcerpt: string): void {
  sentimentHistory.push({
    userId,
    mood: result.mood,
    confidence: result.confidence,
    timestamp: Date.now(),
    messageExcerpt: messageExcerpt.substring(0, 80),
  });

  if (sentimentHistory.length > MAX_HISTORY) {
    sentimentHistory.splice(0, sentimentHistory.length - MAX_HISTORY);
  }
}

export function getSentimentHistory(userId: number, days: number = 7): SentimentHistoryEntry[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return sentimentHistory.filter(e => e.userId === userId && e.timestamp >= cutoff);
}

export function getCurrentMood(userId: number): Mood {
  const recent = sentimentHistory
    .filter(e => e.userId === userId && (Date.now() - e.timestamp) < 30 * 60 * 1000)
    .slice(-5);

  if (recent.length === 0) return 'neutral';

  const moodCounts: Record<Mood, number> = {
    stressed: 0, rushed: 0, relaxed: 0, happy: 0, frustrated: 0, neutral: 0,
  };
  for (const entry of recent) {
    moodCounts[entry.mood] += entry.confidence;
  }

  let dominant: Mood = 'neutral';
  let maxScore = 0;
  for (const [mood, score] of Object.entries(moodCounts) as [Mood, number][]) {
    if (score > maxScore) {
      maxScore = score;
      dominant = mood;
    }
  }
  return dominant;
}

export function getAdaptiveInstructions(sentiment: Mood): string {
  switch (sentiment) {
    case 'stressed':
      return `L'utilisateur semble stressé. Sois rassurant et structuré. Propose des solutions claires étape par étape. Évite de surcharger d'informations. Utilise un ton calme et encourageant.`;
    case 'rushed':
      return `L'utilisateur est pressé. Sois ultra-concis. Donne la réponse essentielle en premier, détails après si demandé. Pas de bavardage. Va droit au but.`;
    case 'frustrated':
      return `L'utilisateur est frustré. Reconnais le problème sans minimiser. Sois empathique mais orienté solution. Évite les formules condescendantes. Propose une action concrète immédiate.`;
    case 'happy':
      return `L'utilisateur est de bonne humeur. Tu peux être plus chaleureux et enthousiaste. Partage sa bonne énergie. C'est le bon moment pour des suggestions proactives.`;
    case 'relaxed':
      return `L'utilisateur est détendu. Tu peux être plus détaillé et conversationnel si pertinent. Bon moment pour des explications approfondies.`;
    case 'neutral':
    default:
      return '';
  }
}

export function getMoodSummary(userId: number, days: number = 7): {
  dominantMood: Mood;
  moodDistribution: Record<Mood, number>;
  totalEntries: number;
  trend: 'improving' | 'declining' | 'stable';
} {
  const history = getSentimentHistory(userId, days);
  const distribution: Record<Mood, number> = {
    stressed: 0, rushed: 0, relaxed: 0, happy: 0, frustrated: 0, neutral: 0,
  };

  for (const entry of history) {
    distribution[entry.mood]++;
  }

  let dominantMood: Mood = 'neutral';
  let maxCount = 0;
  for (const [mood, count] of Object.entries(distribution) as [Mood, number][]) {
    if (count > maxCount) {
      maxCount = count;
      dominantMood = mood;
    }
  }

  const half = Math.floor(history.length / 2);
  const firstHalf = history.slice(0, half);
  const secondHalf = history.slice(half);
  const positiveMoods: Mood[] = ['happy', 'relaxed'];
  const positiveFirst = firstHalf.filter(e => positiveMoods.includes(e.mood)).length / (firstHalf.length || 1);
  const positiveSecond = secondHalf.filter(e => positiveMoods.includes(e.mood)).length / (secondHalf.length || 1);
  const diff = positiveSecond - positiveFirst;
  const trend = diff > 0.15 ? 'improving' : diff < -0.15 ? 'declining' : 'stable';

  return {
    dominantMood,
    moodDistribution: distribution,
    totalEntries: history.length,
    trend,
  };
}
