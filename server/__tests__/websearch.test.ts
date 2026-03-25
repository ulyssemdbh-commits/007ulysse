import { describe, it, expect, vi, beforeEach } from "vitest";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

interface ReliabilityScore {
  overall: number;
  sourceAuthority: number;
  contentFreshness: number;
  crossSourceAgreement: number;
  factualDensity: number;
}

function calculateReliabilityScore(
  sources: { domain: string; date?: Date; facts: string[] }[],
  query: string
): ReliabilityScore {
  if (sources.length === 0) {
    return { overall: 0, sourceAuthority: 0, contentFreshness: 0, crossSourceAgreement: 0, factualDensity: 0 };
  }

  const authorityDomains = ["gov", "edu", "org", "reuters.com", "bbc.com", "nytimes.com"];
  const sourceScores = sources.map(s => {
    const isAuthority = authorityDomains.some(d => s.domain.includes(d));
    return isAuthority ? 100 : 50;
  });
  const sourceAuthority = sourceScores.reduce((a, b) => a + b, 0) / sourceScores.length;

  const now = Date.now();
  const freshnessScores = sources.map(s => {
    if (!s.date) return 50;
    const daysSince = (now - s.date.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) return 100;
    if (daysSince < 30) return 80;
    if (daysSince < 365) return 60;
    return 40;
  });
  const contentFreshness = freshnessScores.reduce((a, b) => a + b, 0) / freshnessScores.length;

  const allFacts = sources.flatMap(s => s.facts);
  const factCounts: Record<string, number> = {};
  allFacts.forEach(f => {
    factCounts[f.toLowerCase()] = (factCounts[f.toLowerCase()] || 0) + 1;
  });
  const agreedFacts = Object.values(factCounts).filter(c => c >= 2).length;
  const crossSourceAgreement = allFacts.length > 0 ? (agreedFacts / Object.keys(factCounts).length) * 100 : 0;

  const factualDensity = Math.min(100, (allFacts.length / sources.length) * 20);

  const overall = (sourceAuthority * 0.3 + contentFreshness * 0.2 + crossSourceAgreement * 0.3 + factualDensity * 0.2);

  return {
    overall: Math.round(overall),
    sourceAuthority: Math.round(sourceAuthority),
    contentFreshness: Math.round(contentFreshness),
    crossSourceAgreement: Math.round(crossSourceAgreement),
    factualDensity: Math.round(factualDensity),
  };
}

function validateSearchResults(results: SearchResult[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!Array.isArray(results)) {
    return { valid: false, errors: ["Results must be an array"] };
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.title) errors.push(`Result ${i}: missing title`);
    if (!r.url) errors.push(`Result ${i}: missing url`);
    if (!r.url?.startsWith("http")) errors.push(`Result ${i}: invalid url format`);
  }

  return { valid: errors.length === 0, errors };
}

describe("Web Search Service", () => {
  describe("Reliability Scoring", () => {
    it("scores authoritative sources higher", () => {
      const authoritySources = [
        { domain: "gov.fr", facts: ["fact1"] },
        { domain: "edu.com", facts: ["fact2"] },
      ];
      const regularSources = [
        { domain: "random-blog.com", facts: ["fact1"] },
        { domain: "unknown-site.net", facts: ["fact2"] },
      ];

      const authorityScore = calculateReliabilityScore(authoritySources, "test");
      const regularScore = calculateReliabilityScore(regularSources, "test");

      expect(authorityScore.sourceAuthority).toBeGreaterThan(regularScore.sourceAuthority);
    });

    it("scores recent content higher", () => {
      const recentSources = [
        { domain: "news.com", date: new Date(), facts: ["fact"] },
      ];
      const oldSources = [
        { domain: "news.com", date: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), facts: ["fact"] },
      ];

      const recentScore = calculateReliabilityScore(recentSources, "test");
      const oldScore = calculateReliabilityScore(oldSources, "test");

      expect(recentScore.contentFreshness).toBeGreaterThan(oldScore.contentFreshness);
    });

    it("scores cross-source agreement", () => {
      const agreeSources = [
        { domain: "site1.com", facts: ["fact1", "fact2"] },
        { domain: "site2.com", facts: ["fact1", "fact2"] },
      ];
      const disagreeSources = [
        { domain: "site1.com", facts: ["fact1"] },
        { domain: "site2.com", facts: ["fact3"] },
      ];

      const agreeScore = calculateReliabilityScore(agreeSources, "test");
      const disagreeScore = calculateReliabilityScore(disagreeSources, "test");

      expect(agreeScore.crossSourceAgreement).toBeGreaterThan(disagreeScore.crossSourceAgreement);
    });

    it("returns zero scores for empty sources", () => {
      const score = calculateReliabilityScore([], "test");
      expect(score.overall).toBe(0);
      expect(score.sourceAuthority).toBe(0);
    });
  });

  describe("Search Result Validation", () => {
    it("validates correct results", () => {
      const results: SearchResult[] = [
        { title: "Test", url: "https://example.com", snippet: "Test snippet", position: 1 },
      ];
      const validation = validateSearchResults(results);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("rejects results without title", () => {
      const results = [
        { title: "", url: "https://example.com", snippet: "Test", position: 1 },
      ] as SearchResult[];
      const validation = validateSearchResults(results);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes("title"))).toBe(true);
    });

    it("rejects results with invalid URL", () => {
      const results: SearchResult[] = [
        { title: "Test", url: "not-a-url", snippet: "Test", position: 1 },
      ];
      const validation = validateSearchResults(results);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes("url"))).toBe(true);
    });

    it("handles non-array input", () => {
      const validation = validateSearchResults(null as any);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toBe("Results must be an array");
    });
  });
});
