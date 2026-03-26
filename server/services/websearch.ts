import { globalOptimizerService } from "./globalOptimizerService";

interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  position?: number;
}

interface SerperResponse {
  organic?: SerperSearchResult[];
  answerBox?: {
    title?: string;
    answer?: string;
    snippet?: string;
  };
  knowledgeGraph?: {
    title?: string;
    description?: string;
  };
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  answer?: string;
  success: boolean;
  error?: string;
  fromCache?: boolean;
}

// Cached version for repeated searches
export async function searchWebCached(query: string, numResults: number = 5): Promise<WebSearchResponse> {
  const cacheKey = `websearch:${query}:${numResults}`;
  
  return globalOptimizerService.getOrFetch(
    cacheKey,
    "web_search",
    () => searchWebDirect(query, numResults),
    { customTTL: 5 * 60 * 1000 } // 5 min TTL for search results
  ).then(result => ({ ...result, fromCache: true }))
    .catch(() => searchWebDirect(query, numResults));
}

export async function searchWeb(query: string, numResults: number = 5): Promise<WebSearchResponse> {
  return searchWebCached(query, numResults);
}

async function searchWebDirect(query: string, numResults: number = 5): Promise<WebSearchResponse> {
  const apiKey = process.env.SERPER_API_KEY;
  
  if (!apiKey) {
    console.error("SERPER_API_KEY not configured");
    return {
      results: [],
      success: false,
      error: "Web search not configured - API key missing"
    };
  }

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q: query,
        num: numResults,
        hl: "fr",
        gl: "fr"
      })
    });

    if (!response.ok) {
      throw new Error(`Serper API error: ${response.status}`);
    }

    const data: SerperResponse = await response.json();
    
    const results: WebSearchResult[] = (data.organic || []).map(item => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet
    }));

    let answer: string | undefined;
    if (data.answerBox?.answer) {
      answer = data.answerBox.answer;
    } else if (data.answerBox?.snippet) {
      answer = data.answerBox.snippet;
    } else if (data.knowledgeGraph?.description) {
      answer = data.knowledgeGraph.description;
    }

    console.log(`Web search for "${query}": found ${results.length} results`);
    
    return {
      results,
      answer,
      success: true
    };
  } catch (error) {
    console.error("Web search error:", error);
    return {
      results: [],
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export function formatSearchResultsForAI(response: WebSearchResponse): string {
  if (!response.success) {
    return `[Recherche web échouée: ${response.error}]`;
  }

  if (response.results.length === 0) {
    return "[Aucun résultat trouvé pour cette recherche]";
  }

  let formatted = "### Résultats de recherche web:\n\n";
  
  if (response.answer) {
    formatted += `**Réponse directe:** ${response.answer}\n\n`;
  }

  for (const result of response.results) {
    formatted += `**${result.title}**\n`;
    formatted += `${result.snippet}\n`;
    formatted += `Source: ${result.url}\n\n`;
  }

  return formatted;
}
