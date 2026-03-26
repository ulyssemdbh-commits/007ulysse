/**
 * MARS Query Rewriter - Reformulate vague queries for better search results
 * 
 * Features:
 * - Expand abbreviations
 * - Add context to ambiguous terms
 * - Convert questions to search-friendly format
 * - Language detection and optimization
 */

export interface RewrittenQuery {
  original: string;
  rewritten: string;
  wasRewritten: boolean;
  transformations: string[];
  confidence: number;
}

// Abréviations courantes français/anglais
const ABBREVIATIONS: Record<string, string> = {
  // Tech
  'js': 'JavaScript',
  'ts': 'TypeScript',
  'py': 'Python',
  'ml': 'machine learning',
  'ai': 'artificial intelligence',
  'api': 'API interface',
  'ui': 'user interface',
  'ux': 'user experience',
  'db': 'database',
  'css': 'CSS styles',
  'html': 'HTML markup',
  'npm': 'npm package manager',
  'aws': 'Amazon Web Services',
  'gcp': 'Google Cloud Platform',
  
  // Sports
  'om': 'Olympique de Marseille football',
  'psg': 'Paris Saint-Germain football',
  'ol': 'Olympique Lyonnais football',
  'asse': 'AS Saint-Étienne football',
  'losc': 'LOSC Lille football',
  'ogcn': 'OGC Nice football',
  'nba': 'NBA basketball',
  'nfl': 'NFL football américain',
  'nhl': 'NHL hockey',
  'f1': 'Formule 1',
  'ucl': 'UEFA Champions League',
  
  // Général
  'cv': 'curriculum vitae',
  'rh': 'ressources humaines',
  'pme': 'petites et moyennes entreprises',
  'tva': 'taxe sur la valeur ajoutée',
  'smic': 'salaire minimum',
  'cdi': 'contrat à durée indéterminée',
  'cdd': 'contrat à durée déterminée'
};

// Patterns de questions à reformuler
const QUESTION_PATTERNS: Array<{
  pattern: RegExp;
  replacement: (match: string, ...groups: string[]) => string;
}> = [
  {
    pattern: /^c'?est quoi\s+(.+)\?*$/i,
    replacement: (_, term) => `définition ${term} explication`
  },
  {
    pattern: /^qu'?est[- ]ce que\s+(.+)\?*$/i,
    replacement: (_, term) => `définition ${term} explication`
  },
  {
    pattern: /^comment\s+(.+)\?*$/i,
    replacement: (_, action) => `tutoriel ${action} guide étapes`
  },
  {
    pattern: /^pourquoi\s+(.+)\?*$/i,
    replacement: (_, reason) => `raison ${reason} explication cause`
  },
  {
    pattern: /^combien\s+(.+)\?*$/i,
    replacement: (_, what) => `nombre quantité ${what} chiffres statistiques`
  },
  {
    pattern: /^quand\s+(.+)\?*$/i,
    replacement: (_, event) => `date ${event} calendrier`
  },
  {
    pattern: /^où\s+(.+)\?*$/i,
    replacement: (_, location) => `lieu ${location} localisation adresse`
  },
  {
    pattern: /^qui\s+(.+)\?*$/i,
    replacement: (_, person) => `${person} biographie profil`
  }
];

// Termes vagues à enrichir
const VAGUE_TERMS: Record<string, string> = {
  'meilleur': 'meilleur top classement comparatif 2024 2025',
  'mieux': 'meilleur recommandé conseillé',
  'nouveau': 'nouveau récent dernière version actualité',
  'problème': 'problème solution résolution erreur',
  'erreur': 'erreur message solution fix debug',
  'bug': 'bug erreur solution fix résolution',
  'prix': 'prix coût tarif comparatif',
  'avis': 'avis test review comparatif note',
  'différence': 'différence comparaison versus vs avantages'
};

/**
 * Réécrit une requête pour améliorer les résultats de recherche
 */
export function rewriteQuery(query: string): RewrittenQuery {
  let rewritten = query.trim();
  const transformations: string[] = [];
  let confidence = 1.0;

  // Requête trop courte - pas de réécriture fiable
  if (rewritten.length < 3) {
    return {
      original: query,
      rewritten: query,
      wasRewritten: false,
      transformations: [],
      confidence: 0.3
    };
  }

  // 1. Expansion des abréviations
  const words = rewritten.split(/\s+/);
  const expandedWords = words.map(word => {
    const lower = word.toLowerCase().replace(/[.,!?]/g, '');
    if (ABBREVIATIONS[lower]) {
      transformations.push(`abbr:${lower}→${ABBREVIATIONS[lower]}`);
      return ABBREVIATIONS[lower];
    }
    return word;
  });
  
  if (transformations.length > 0) {
    rewritten = expandedWords.join(' ');
  }

  // 2. Reformulation des questions
  for (const { pattern, replacement } of QUESTION_PATTERNS) {
    const match = rewritten.match(pattern);
    if (match) {
      const before = rewritten;
      rewritten = replacement(match[0], ...match.slice(1));
      transformations.push(`question:${pattern.source.substring(0, 20)}...`);
      confidence *= 0.9; // Légère pénalité car reformulation
      break;
    }
  }

  // 3. Enrichissement des termes vagues
  for (const [vague, enriched] of Object.entries(VAGUE_TERMS)) {
    const vagueRegex = new RegExp(`\\b${vague}\\b`, 'gi');
    if (vagueRegex.test(rewritten)) {
      // Ajouter les termes enrichis sans remplacer
      if (!rewritten.toLowerCase().includes(enriched.split(' ')[1])) {
        rewritten = `${rewritten} ${enriched}`;
        transformations.push(`enrich:${vague}`);
        confidence *= 0.95;
      }
    }
  }

  // 4. Ajout de contexte temporel si pertinent
  const temporalKeywords = ['actualité', 'news', 'dernier', 'récent', 'aujourd\'hui', 'maintenant'];
  const hasTemporalContext = temporalKeywords.some(k => rewritten.toLowerCase().includes(k));
  
  if (!hasTemporalContext) {
    const needsTemporalContext = [
      /\bprix\b/i, /\bcours\b/i, /\bscore\b/i, /\bmatch\b/i,
      /\bclassement\b/i, /\brésultat\b/i, /\bactualité\b/i
    ];
    
    if (needsTemporalContext.some(p => p.test(rewritten))) {
      const year = new Date().getFullYear();
      rewritten = `${rewritten} ${year}`;
      transformations.push('temporal:year');
    }
  }

  // 5. Nettoyage final
  rewritten = rewritten
    .replace(/\s+/g, ' ')
    .replace(/\?+$/, '')
    .trim();

  const wasRewritten = transformations.length > 0 && rewritten !== query.trim();

  if (wasRewritten) {
    console.log(`[MARS:Rewriter] "${query}" → "${rewritten}" (${transformations.join(', ')})`);
  }

  return {
    original: query,
    rewritten,
    wasRewritten,
    transformations,
    confidence
  };
}

/**
 * Analyse la qualité d'une requête
 */
export function analyzeQueryQuality(query: string): {
  score: number;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  // Longueur
  if (query.length < 5) {
    issues.push('Trop courte');
    suggestions.push('Ajoutez plus de détails');
    score -= 40;
  } else if (query.length < 15) {
    issues.push('Plutôt courte');
    suggestions.push('Précisez votre recherche');
    score -= 15;
  }

  // Mots
  const wordCount = query.split(/\s+/).length;
  if (wordCount < 2) {
    issues.push('Un seul mot');
    suggestions.push('Utilisez plusieurs mots-clés');
    score -= 25;
  }

  // Questions mal formées
  if (/^(quoi|comment|pourquoi|où|qui|quand)\?*$/i.test(query.trim())) {
    issues.push('Question incomplète');
    suggestions.push('Complétez votre question');
    score -= 50;
  }

  // Caractères spéciaux excessifs
  const specialCount = (query.match(/[^a-zA-Z0-9\s\-'éèêëàâäùûüôöîïç]/g) || []).length;
  if (specialCount > 3) {
    issues.push('Trop de caractères spéciaux');
    suggestions.push('Simplifiez la syntaxe');
    score -= 10;
  }

  return {
    score: Math.max(0, score),
    issues,
    suggestions
  };
}

export const marsQueryRewriter = {
  rewriteQuery,
  analyzeQueryQuality
};
