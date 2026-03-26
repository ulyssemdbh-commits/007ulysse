/**
 * Structured Data Extractor - Universal content-to-JSON converter
 * Detects content type and extracts structured data automatically
 */

import OpenAI from "openai";

// Use AI Integrations for Replit Core compatibility
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export type ContentType = 
  | 'sports_ranking'
  | 'sports_scores'
  | 'betting_odds'
  | 'news_article'
  | 'product_listing'
  | 'price_list'
  | 'table_data'
  | 'unknown';

export interface ExtractionResult<T = any> {
  success: boolean;
  contentType: ContentType;
  data: T;
  confidence: number;
  source: string;
  extractedAt: string;
  error?: string;
}

export interface RankingData {
  type: 'ranking';
  title: string;
  items: Array<{
    position: number;
    name: string;
    score?: number;
    stats?: Record<string, number | string>;
  }>;
}

export interface TopScorersData {
  type: 'topScorers';
  items: Array<{
    position: number;
    name: string;
    team?: string;
    goals: number;
  }>;
}

export interface FixturesData {
  type: 'fixtures';
  matchday?: number;
  items: Array<{
    homeTeam: string;
    awayTeam: string;
  }>;
}

export interface FootballPageData {
  type: 'footballPage';
  ranking: RankingData;
  topScorers?: TopScorersData;
  fixtures?: FixturesData;
}

export interface ScoresData {
  type: 'scores';
  matches: Array<{
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    status: string;
    date?: string;
  }>;
}

export interface OddsData {
  type: 'odds';
  matches: Array<{
    teams: string;
    homeOdds: number;
    drawOdds?: number;
    awayOdds: number;
    bookmaker?: string;
  }>;
}

export interface ArticleData {
  type: 'article';
  title: string;
  author?: string;
  date?: string;
  summary: string;
  content: string;
  tags?: string[];
}

export interface TableData {
  type: 'table';
  title?: string;
  headers: string[];
  rows: (string | number)[][];
}

export interface ProductData {
  type: 'products';
  items: Array<{
    name: string;
    price?: number;
    currency?: string;
    description?: string;
    url?: string;
  }>;
}

function prepareContentForAI(content: string, contentType: ContentType): string {
  const MAX_CHARS = 25000;
  
  if (contentType === 'sports_ranking' || contentType === 'table_data') {
    const tablePattern = /(\|[^\n]+\|[\s\S]*?\|[^\n]+\|)/g;
    const tables = content.match(tablePattern);
    
    if (tables && tables.length > 0) {
      const allTables = tables.join('\n\n---TABLE---\n\n');
      const context = content.substring(0, 500);
      const result = `${context}\n\n${allTables}`;
      
      if (result.length <= MAX_CHARS) {
        return result;
      }
      return result.substring(0, MAX_CHARS);
    }
  }
  
  if (contentType === 'news_article') {
    return content.substring(0, MAX_CHARS);
  }
  
  return content.substring(0, MAX_CHARS);
}

function detectContentType(content: string, url: string): ContentType {
  const lowerContent = content.toLowerCase();
  const lowerUrl = url.toLowerCase();
  
  const sportsSites = ['eurotopteam', 'lequipe', 'sofascore', 'flashscore', 'livescore'];
  const bettingSites = ['parionssport', 'winamax', 'betclic', 'unibet', 'pmu', 'zebet'];
  const blogSites = ['medium.com', 'dev.to', 'overreacted', 'blog', 'hashnode', 'substack'];
  const newsSites = ['lemonde', 'lefigaro', 'bfm', 'reuters', 'bbc', 'cnn', 'news', 'actualite'];
  
  if (bettingSites.some(s => lowerUrl.includes(s))) {
    return 'betting_odds';
  }
  
  if (sportsSites.some(s => lowerUrl.includes(s)) || 
      (lowerContent.includes('classement') && lowerContent.includes('pts'))) {
    if (lowerContent.includes('score') && lowerContent.includes('match')) {
      return 'sports_scores';
    }
    return 'sports_ranking';
  }
  
  if (blogSites.some(s => lowerUrl.includes(s)) || 
      newsSites.some(s => lowerUrl.includes(s)) ||
      lowerUrl.includes('/article') || lowerUrl.includes('/post') ||
      lowerUrl.match(/\/\d{4}\/\d{2}\//) ||
      (content.length > 3000 && !content.includes('|'))) {
    return 'news_article';
  }
  
  if (content.includes('|') && content.split('|').length > 20) {
    return 'table_data';
  }
  
  if ((lowerContent.includes('prix') || lowerContent.includes('€') || 
       lowerContent.includes('price') || lowerContent.includes('$')) &&
      (lowerContent.includes('produit') || lowerContent.includes('product') ||
       lowerContent.includes('acheter') || lowerContent.includes('buy'))) {
    return 'product_listing';
  }
  
  if (content.length > 2000) {
    return 'news_article';
  }
  
  return 'unknown';
}

function getExtractionPrompt(contentType: ContentType): string {
  switch (contentType) {
    case 'sports_ranking':
      return `Extrais le classement sportif COMPLET en JSON structuré.
Format attendu:
{
  "type": "ranking",
  "title": "Nom du classement",
  "items": [
    { 
      "position": 1, 
      "name": "Équipe/Joueur", 
      "score": 50, 
      "stats": { 
        "J": 23, 
        "V": 15, 
        "N": 5, 
        "D": 3, 
        "BP": 42, 
        "BC": 17, 
        "Diff": 25 
      } 
    }
  ]
}
IMPORTANT: 
- Extrais TOUTES les équipes/entrées du classement (20 pour une ligue)
- J = Joués (matchs joués), V = Victoires, N = Nuls, D = Défaites
- BP = Buts Pour, BC = Buts Contre, Diff = Différence de buts
- score = Points totaux
- Extrais TOUS les champs stats disponibles dans le tableau source`;

    case 'sports_scores':
      return `Extrais les scores des matchs en JSON structuré.
Format attendu:
{
  "type": "scores",
  "matches": [
    { "homeTeam": "Équipe A", "awayTeam": "Équipe B", "homeScore": 2, "awayScore": 1, "status": "Terminé" }
  ]
}`;

    case 'betting_odds':
      return `Extrais les cotes de paris en JSON structuré.
Format attendu:
{
  "type": "odds",
  "matches": [
    { "teams": "Équipe A - Équipe B", "homeOdds": 1.85, "drawOdds": 3.40, "awayOdds": 4.20, "bookmaker": "Source" }
  ]
}`;

    case 'news_article':
      return `Extrais l'article en JSON structuré.
Format attendu:
{
  "type": "article",
  "title": "Titre",
  "author": "Auteur",
  "date": "Date",
  "summary": "Résumé en 2-3 phrases",
  "content": "Contenu principal",
  "tags": ["tag1", "tag2"]
}`;

    case 'product_listing':
      return `Extrais les produits en JSON structuré.
Format attendu:
{
  "type": "products",
  "items": [
    { "name": "Produit", "price": 29.99, "currency": "EUR", "description": "Description" }
  ]
}`;

    case 'table_data':
      return `Extrais les données tabulaires en JSON structuré.
Format attendu:
{
  "type": "table",
  "title": "Titre du tableau",
  "headers": ["Col1", "Col2", "Col3"],
  "rows": [["val1", "val2", 123], ["val1", "val2", 456]]
}
Conserve les types (nombres vs texte).`;

    default:
      return `Extrais les données principales en JSON structuré.
Identifie le type de contenu et crée une structure JSON appropriée.
Inclus un champ "type" pour identifier le format des données.`;
  }
}

export async function extractStructuredData(
  content: string,
  url: string,
  forceType?: ContentType
): Promise<ExtractionResult> {
  const contentType = forceType || detectContentType(content, url);
  const prompt = getExtractionPrompt(contentType);
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Tu es un extracteur de données structurées. ${prompt}

RÈGLES CRITIQUES:
- Retourne UNIQUEMENT du JSON valide, sans markdown ni texte avant/après
- Extrais TOUTES les données, pas un échantillon
- Si une donnée est manquante, utilise null
- Les nombres doivent être des nombres, pas des strings
- INTERDICTION d'inventer des données - utilise uniquement ce qui est dans le contenu`
        },
        {
          role: "user",
          content: `URL source: ${url}\n\nContenu à extraire:\n${prepareContentForAI(content, contentType)}`
        }
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: "json_object" }
    });
    
    const jsonStr = response.choices[0].message.content || '{}';
    let data: any = {};
    try { data = JSON.parse(jsonStr); } catch { console.warn("[StructuredExtractor] Failed to parse AI response"); }
    
    const itemCount = 
      data.items?.length || 
      data.matches?.length || 
      data.rows?.length || 
      (data.title ? 1 : 0);
    
    const confidence = itemCount > 0 ? Math.min(0.95, 0.5 + (itemCount * 0.05)) : 0.3;
    
    return {
      success: itemCount > 0,
      contentType,
      data,
      confidence,
      source: url,
      extractedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('[StructuredExtractor] Error:', error.message);
    return {
      success: false,
      contentType,
      data: null,
      confidence: 0,
      source: url,
      extractedAt: new Date().toISOString(),
      error: error.message,
    };
  }
}

export async function smartExtract(url: string, forceType?: ContentType): Promise<ExtractionResult> {
  const { smartCrawl } = await import('../core/strategyEngine');
  
  const crawlResult = await smartCrawl({
    url,
    qualityThreshold: 0.3,
    timeout: 30000,
  });
  
  if (!crawlResult.success || !crawlResult.content) {
    return {
      success: false,
      contentType: 'unknown',
      data: null,
      confidence: 0,
      source: url,
      extractedAt: new Date().toISOString(),
      error: crawlResult.error || 'Failed to fetch content',
    };
  }
  
  console.log(`[StructuredExtractor] Crawled ${url}: ${crawlResult.content.length} chars via ${crawlResult.strategyUsed}`);
  
  return extractStructuredData(crawlResult.content, url, forceType);
}
