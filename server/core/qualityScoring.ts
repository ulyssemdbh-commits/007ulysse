/**
 * Quality Scoring - Evaluates the quality of scraped content
 * Used to detect failed extractions and trigger fallback strategies
 */

import * as cheerio from 'cheerio';
import { QualityMetrics } from './strategyTypes';

export function calculateQualityScore(
  content: string,
  html?: string,
  url?: string
): { score: number; metrics: QualityMetrics } {
  const metrics: QualityMetrics = {
    hasTitle: false,
    hasContent: false,
    contentLength: content?.length || 0,
    wordCount: 0,
    hasStructuredData: false,
    hasMetadata: false,
    linkCount: 0,
    imageCount: 0,
    jsDetected: false,
    emptyBodyRatio: 1,
  };

  if (!content && !html) {
    return { score: 0, metrics };
  }

  const text = content || '';
  metrics.wordCount = text.split(/\s+/).filter(w => w.length > 2).length;
  metrics.hasContent = metrics.wordCount > 50;

  if (html) {
    try {
      const $ = cheerio.load(html);
      
      const title = $('title').text().trim();
      metrics.hasTitle = title.length > 3;
      
      metrics.linkCount = $('a[href]').length;
      metrics.imageCount = $('img').length;
      
      const description = $('meta[name="description"]').attr('content') ||
                          $('meta[property="og:description"]').attr('content');
      metrics.hasMetadata = !!description && description.length > 10;
      
      const hasJsonLd = $('script[type="application/ld+json"]').length > 0;
      const hasMicrodata = $('[itemscope]').length > 0;
      metrics.hasStructuredData = hasJsonLd || hasMicrodata;
      
      const jsIndicators = [
        $('script[src*="react"]').length > 0,
        $('script[src*="vue"]').length > 0,
        $('script[src*="angular"]').length > 0,
        $('script[src*="next"]').length > 0,
        $('div#__next').length > 0,
        $('div#root').length > 0 && $('div#root').children().length < 3,
        $('noscript').text().toLowerCase().includes('javascript'),
        html.includes('__NEXT_DATA__'),
        html.includes('window.__NUXT__'),
        html.includes('ng-app'),
      ];
      metrics.jsDetected = jsIndicators.some(Boolean);
      
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
      const totalHtmlLength = html.length;
      metrics.emptyBodyRatio = bodyText.length / Math.max(totalHtmlLength, 1);
      
    } catch (e) {
      console.warn('[QualityScoring] HTML parsing error:', e);
    }
  }

  let score = 0;
  
  if (metrics.hasTitle) score += 0.1;
  if (metrics.hasContent) score += 0.15;
  if (metrics.hasMetadata) score += 0.1;
  if (metrics.hasStructuredData) score += 0.05;
  
  if (metrics.wordCount >= 100) score += 0.15;
  else if (metrics.wordCount >= 50) score += 0.1;
  else if (metrics.wordCount >= 20) score += 0.05;
  
  if (metrics.contentLength >= 5000) score += 0.15;
  else if (metrics.contentLength >= 1000) score += 0.1;
  else if (metrics.contentLength >= 300) score += 0.05;
  
  if (metrics.linkCount > 0 && metrics.linkCount < 200) score += 0.05;
  if (metrics.imageCount > 0 && metrics.imageCount < 50) score += 0.05;
  
  if (metrics.emptyBodyRatio > 0.1) score += 0.1;
  if (metrics.emptyBodyRatio > 0.3) score += 0.1;
  
  if (metrics.jsDetected && metrics.wordCount < 50) {
    score = Math.max(0, score - 0.2);
  }

  score = Math.min(1, Math.max(0, score));

  return { score, metrics };
}

export function detectSPAIndicators(html: string): boolean {
  if (!html) return false;
  
  const spaPatterns = [
    /<div\s+id=["']root["']\s*>\s*<\/div>/i,
    /<div\s+id=["']app["']\s*>\s*<\/div>/i,
    /<div\s+id=["']__next["']/i,
    /window\.__INITIAL_STATE__/,
    /window\.__NUXT__/,
    /window\.__NEXT_DATA__/,
    /ng-app/,
    /data-reactroot/,
    /<noscript>.*?javascript.*?<\/noscript>/is,
  ];
  
  return spaPatterns.some(pattern => pattern.test(html));
}

export function isContentSufficient(
  content: string,
  minLength: number = 100,
  minWords: number = 20
): boolean {
  if (!content) return false;
  if (content.length < minLength) return false;
  
  const wordCount = content.split(/\s+/).filter(w => w.length > 2).length;
  return wordCount >= minWords;
}

export function estimateJsRequirement(html: string, content: string): boolean {
  if (!html) return false;
  
  const htmlLength = html.length;
  const contentLength = content?.length || 0;
  
  if (htmlLength > 10000 && contentLength < 500) {
    return true;
  }
  
  if (detectSPAIndicators(html)) {
    return true;
  }
  
  return false;
}
