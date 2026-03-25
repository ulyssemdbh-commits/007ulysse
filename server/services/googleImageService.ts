import { cache } from "./cache";

interface GoogleImageResult {
  title: string;
  link: string;
  thumbnailLink: string;
  contextLink: string;
  width: number;
  height: number;
}

interface GoogleImageSearchResponse {
  items?: Array<{
    title: string;
    link: string;
    image: {
      thumbnailLink: string;
      contextLink: string;
      width: number;
      height: number;
    };
  }>;
  searchInformation?: {
    totalResults: string;
    searchTime: number;
  };
  error?: {
    code: number;
    message: string;
  };
}

interface ImageSearchResult {
  success: boolean;
  images: GoogleImageResult[];
  query: string;
  totalResults: number;
  remainingQuota: number;
  error?: string;
}

const DAILY_QUOTA = 100;
const QUOTA_CACHE_KEY = "google_image_daily_quota";

function getQuotaCacheKey(): string {
  const today = new Date().toISOString().split("T")[0];
  return `${QUOTA_CACHE_KEY}_${today}`;
}

function getDailyUsage(): number {
  const usage = cache.get<number>(getQuotaCacheKey());
  return usage || 0;
}

function incrementDailyUsage(): number {
  const key = getQuotaCacheKey();
  const current = getDailyUsage();
  const newUsage = current + 1;
  const msUntilMidnight = getMsUntilMidnight();
  cache.set(key, newUsage, msUntilMidnight);
  return newUsage;
}

function getMsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

export function getRemainingQuota(): number {
  return Math.max(0, DAILY_QUOTA - getDailyUsage());
}

export function canMakeRequest(): boolean {
  return getRemainingQuota() > 0;
}

export async function searchImages(
  query: string,
  count: number = 5
): Promise<ImageSearchResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    return {
      success: false,
      images: [],
      query,
      totalResults: 0,
      remainingQuota: getRemainingQuota(),
      error: "Google API credentials not configured"
    };
  }

  if (!canMakeRequest()) {
    return {
      success: false,
      images: [],
      query,
      totalResults: 0,
      remainingQuota: 0,
      error: `Quota journalier de ${DAILY_QUOTA} images atteint. Réessaye demain.`
    };
  }

  const cacheKey = `google_images_${query}_${count}`;
  const cached = cache.get<ImageSearchResult>(cacheKey);
  if (cached) {
    console.log(`[GoogleImage] Cache hit for: ${query}`);
    return cached;
  }

  try {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("cx", searchEngineId);
    url.searchParams.set("q", query);
    url.searchParams.set("searchType", "image");
    url.searchParams.set("num", Math.min(count, 10).toString());
    url.searchParams.set("safe", "active");

    console.log(`[GoogleImage] Searching for: ${query}`);
    
    const response = await fetch(url.toString());
    const data: GoogleImageSearchResponse = await response.json();

    if (data.error) {
      console.error(`[GoogleImage] API error:`, data.error);
      return {
        success: false,
        images: [],
        query,
        totalResults: 0,
        remainingQuota: getRemainingQuota(),
        error: data.error.message
      };
    }

    incrementDailyUsage();

    const images: GoogleImageResult[] = (data.items || []).map(item => ({
      title: item.title,
      link: item.link,
      thumbnailLink: item.image.thumbnailLink,
      contextLink: item.image.contextLink,
      width: item.image.width,
      height: item.image.height
    }));

    const result: ImageSearchResult = {
      success: true,
      images,
      query,
      totalResults: parseInt(data.searchInformation?.totalResults || "0", 10),
      remainingQuota: getRemainingQuota()
    };

    cache.set(cacheKey, result, 60 * 60 * 1000);

    console.log(`[GoogleImage] Found ${images.length} images for: ${query} (remaining quota: ${result.remainingQuota})`);
    
    return result;
  } catch (error) {
    console.error("[GoogleImage] Search failed:", error);
    return {
      success: false,
      images: [],
      query,
      totalResults: 0,
      remainingQuota: getRemainingQuota(),
      error: error instanceof Error ? error.message : "Search failed"
    };
  }
}

export function getQuotaStatus(): { used: number; remaining: number; limit: number } {
  const used = getDailyUsage();
  return {
    used,
    remaining: DAILY_QUOTA - used,
    limit: DAILY_QUOTA
  };
}
