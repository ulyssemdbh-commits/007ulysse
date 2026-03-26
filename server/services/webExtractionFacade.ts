import { crawl, type CrawlRequest, type CrawlResponse } from "./scraper/crawl";
import { smartCrawl } from "../core/strategyEngine";
import type { SmartCrawlRequest, SmartCrawlResult } from "../core/strategyTypes";

export const webExtractionFacade = {
    crawlUrl(request: CrawlRequest): Promise<CrawlResponse> {
        return crawl(request);
    },

    smartCrawlUrl(request: SmartCrawlRequest): Promise<SmartCrawlResult> {
        return smartCrawl(request);
    }
};

export type { CrawlRequest, CrawlResponse, SmartCrawlRequest, SmartCrawlResult };
