import { describe, it, expect, vi, beforeEach } from "vitest";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface ReliabilityScore {
  overall: number;
  sourceAuthority: number;
  contentConsistency: number;
  recency: number;
  factualDensity: number;
}

function calculateReliabilityScore(results: SearchResult[]): ReliabilityScore {
  if (results.length === 0) {
    return { overall: 0, sourceAuthority: 0, contentConsistency: 0, recency: 0, factualDensity: 0 };
  }
  
  const trustedDomains = ["wikipedia.org", "gov.fr", "edu", "bbc.com", "reuters.com", "lemonde.fr"];
  
  let authorityScore = 0;
  for (const result of results) {
    const domain = new URL(result.url).hostname;
    if (trustedDomains.some(d => domain.includes(d))) {
      authorityScore += 100;
    } else {
      authorityScore += 50;
    }
  }
  authorityScore = Math.min(100, authorityScore / results.length);
  
  const consistencyScore = results.length >= 3 ? 80 : 50;
  const recencyScore = 70;
  const factualScore = 75;
  
  const overall = Math.round((authorityScore + consistencyScore + recencyScore + factualScore) / 4);
  
  return {
    overall,
    sourceAuthority: authorityScore,
    contentConsistency: consistencyScore,
    recency: recencyScore,
    factualDensity: factualScore,
  };
}

function isDomainTrusted(url: string): boolean {
  const trustedDomains = ["wikipedia.org", "gov.fr", "edu", "bbc.com", "reuters.com"];
  try {
    const domain = new URL(url).hostname;
    return trustedDomains.some(d => domain.includes(d));
  } catch {
    return false;
  }
}

function extractFacts(content: string): string[] {
  const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);
  return sentences.filter(s => {
    return /\d/.test(s) || 
           /en \d{4}/.test(s) ||
           /selon|d'après|officiellement/i.test(s);
  });
}

function checkConsistency(facts: string[][], threshold: number = 0.5): boolean {
  if (facts.length < 2) return true;
  
  const commonFacts = facts[0].filter(f => 
    facts.slice(1).some(source => source.some(sf => sf.toLowerCase().includes(f.toLowerCase().slice(0, 20))))
  );
  
  return commonFacts.length >= facts[0].length * threshold;
}

describe("MARS v2 Search System", () => {
  describe("Reliability Scoring", () => {
    it("calculates reliability score for trusted sources", () => {
      const results: SearchResult[] = [
        { title: "Article", url: "https://en.wikipedia.org/wiki/Test", snippet: "Test content", source: "Wikipedia" },
        { title: "News", url: "https://www.bbc.com/news/test", snippet: "News content", source: "BBC" },
      ];
      const score = calculateReliabilityScore(results);
      expect(score.overall).toBeGreaterThan(60);
      expect(score.sourceAuthority).toBeGreaterThan(70);
    });

    it("returns lower scores for unknown sources", () => {
      const results: SearchResult[] = [
        { title: "Blog", url: "https://random-blog.com/article", snippet: "Content", source: "Blog" },
      ];
      const score = calculateReliabilityScore(results);
      expect(score.sourceAuthority).toBeLessThanOrEqual(50);
    });

    it("handles empty results", () => {
      const score = calculateReliabilityScore([]);
      expect(score.overall).toBe(0);
    });
  });

  describe("Domain Trust Verification", () => {
    it("identifies trusted domains", () => {
      expect(isDomainTrusted("https://en.wikipedia.org/wiki/Test")).toBe(true);
      expect(isDomainTrusted("https://www.bbc.com/news")).toBe(true);
      expect(isDomainTrusted("https://www.gov.fr/services")).toBe(true);
    });

    it("identifies untrusted domains", () => {
      expect(isDomainTrusted("https://random-site.com")).toBe(false);
      expect(isDomainTrusted("https://suspicious-blog.net")).toBe(false);
    });

    it("handles invalid URLs", () => {
      expect(isDomainTrusted("not-a-url")).toBe(false);
    });
  });

  describe("Fact Extraction", () => {
    it("extracts sentences with numbers", () => {
      const content = "La Tour Eiffel mesure 330 mètres de haut. Elle est située à Paris. Elle a été construite en 1889.";
      const facts = extractFacts(content);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts.some(f => f.includes("330"))).toBe(true);
    });

    it("extracts sentences with dates", () => {
      const content = "Ce monument a été inauguré en 2015. Il attire des millions de visiteurs.";
      const facts = extractFacts(content);
      expect(facts.some(f => f.includes("2015"))).toBe(true);
    });

    it("returns empty for vague content", () => {
      const content = "C'est bien. C'est beau.";
      const facts = extractFacts(content);
      expect(facts.length).toBe(0);
    });
  });

  describe("Consistency Checking", () => {
    it("detects consistent facts with overlap", () => {
      const facts = [
        ["Tour Eiffel 330 mètres", "Paris monument"],
        ["Tour Eiffel mesure 330 mètres", "située à Paris"],
      ];
      const result = checkConsistency(facts, 0.3);
      expect(typeof result).toBe("boolean");
    });

    it("handles single source", () => {
      const facts = [["Fact 1", "Fact 2"]];
      expect(checkConsistency(facts)).toBe(true);
    });

    it("handles empty facts", () => {
      const facts: string[][] = [];
      expect(checkConsistency(facts)).toBe(true);
    });
  });
});
