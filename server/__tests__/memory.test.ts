import { describe, it, expect, beforeEach } from "vitest";

interface MemoryEntry {
  id: number;
  userId: number;
  category: string;
  content: string;
  importance: number;
  lastAccessed: Date;
  accessCount: number;
  embedding?: number[];
  createdAt: Date;
}

function jaccardSimilarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 0));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 0));
  
  if (setA.size === 0 || setB.size === 0) return 0;
  
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function calculateRelevanceScore(
  memory: MemoryEntry,
  query: string,
  weights: { recency: number; importance: number; access: number; similarity: number }
): number {
  const daysSinceAccess = (Date.now() - memory.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.max(0, 1 - daysSinceAccess / 30);
  
  const importanceScore = memory.importance / 10;
  
  const accessScore = Math.min(1, memory.accessCount / 10);
  
  const similarityScore = jaccardSimilarity(memory.content, query);
  
  return (
    recencyScore * weights.recency +
    importanceScore * weights.importance +
    accessScore * weights.access +
    similarityScore * weights.similarity
  );
}

function findDuplicates(memories: MemoryEntry[], threshold: number = 0.7): [number, number][] {
  const duplicates: [number, number][] = [];
  
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const similarity = jaccardSimilarity(memories[i].content, memories[j].content);
      if (similarity >= threshold) {
        duplicates.push([memories[i].id, memories[j].id]);
      }
    }
  }
  
  return duplicates;
}

describe("Memory Service", () => {
  describe("Jaccard Similarity", () => {
    it("returns 1 for identical strings", () => {
      const similarity = jaccardSimilarity("hello world", "hello world");
      expect(similarity).toBe(1);
    });

    it("returns 0 for completely different strings", () => {
      const similarity = jaccardSimilarity("hello world", "foo bar");
      expect(similarity).toBe(0);
    });

    it("returns correct partial similarity", () => {
      const similarity = jaccardSimilarity("hello world", "hello there");
      expect(similarity).toBeCloseTo(0.333, 2);
    });

    it("is case insensitive", () => {
      const similarity = jaccardSimilarity("Hello World", "HELLO WORLD");
      expect(similarity).toBe(1);
    });

    it("handles empty strings", () => {
      expect(jaccardSimilarity("", "")).toBe(0);
      expect(jaccardSimilarity("hello", "")).toBe(0);
    });
  });

  describe("Relevance Scoring", () => {
    const baseMemory: MemoryEntry = {
      id: 1,
      userId: 1,
      category: "general",
      content: "User prefers morning meetings",
      importance: 5,
      lastAccessed: new Date(),
      accessCount: 3,
      createdAt: new Date()
    };

    const weights = { recency: 0.3, importance: 0.3, access: 0.2, similarity: 0.2 };

    it("scores recently accessed memories higher", () => {
      const recentMemory = { ...baseMemory, lastAccessed: new Date() };
      const oldMemory = { 
        ...baseMemory, 
        id: 2,
        lastAccessed: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
      };
      
      const recentScore = calculateRelevanceScore(recentMemory, "meetings", weights);
      const oldScore = calculateRelevanceScore(oldMemory, "meetings", weights);
      
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it("scores high importance memories higher", () => {
      const highImportance = { ...baseMemory, importance: 10 };
      const lowImportance = { ...baseMemory, id: 2, importance: 1 };
      
      const highScore = calculateRelevanceScore(highImportance, "test", weights);
      const lowScore = calculateRelevanceScore(lowImportance, "test", weights);
      
      expect(highScore).toBeGreaterThan(lowScore);
    });

    it("scores frequently accessed memories higher", () => {
      const frequentAccess = { ...baseMemory, accessCount: 10 };
      const rareAccess = { ...baseMemory, id: 2, accessCount: 1 };
      
      const frequentScore = calculateRelevanceScore(frequentAccess, "test", weights);
      const rareScore = calculateRelevanceScore(rareAccess, "test", weights);
      
      expect(frequentScore).toBeGreaterThan(rareScore);
    });

    it("scores similar content higher", () => {
      const matchingMemory = { ...baseMemory, content: "meetings are scheduled for mornings" };
      const nonMatchingMemory = { ...baseMemory, id: 2, content: "dinner reservations at night" };
      
      const matchScore = calculateRelevanceScore(matchingMemory, "morning meetings", weights);
      const noMatchScore = calculateRelevanceScore(nonMatchingMemory, "morning meetings", weights);
      
      expect(matchScore).toBeGreaterThan(noMatchScore);
    });
  });

  describe("Duplicate Detection", () => {
    it("finds exact duplicates", () => {
      const memories: MemoryEntry[] = [
        { id: 1, userId: 1, category: "test", content: "hello world", importance: 5, lastAccessed: new Date(), accessCount: 1, createdAt: new Date() },
        { id: 2, userId: 1, category: "test", content: "hello world", importance: 5, lastAccessed: new Date(), accessCount: 1, createdAt: new Date() }
      ];
      
      const duplicates = findDuplicates(memories, 0.9);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).toEqual([1, 2]);
    });

    it("finds similar duplicates", () => {
      const memories: MemoryEntry[] = [
        { id: 1, userId: 1, category: "test", content: "user likes coffee morning", importance: 5, lastAccessed: new Date(), accessCount: 1, createdAt: new Date() },
        { id: 2, userId: 1, category: "test", content: "user likes coffee in morning", importance: 5, lastAccessed: new Date(), accessCount: 1, createdAt: new Date() }
      ];
      
      const duplicates = findDuplicates(memories, 0.6);
      expect(duplicates).toHaveLength(1);
    });

    it("does not flag different memories as duplicates", () => {
      const memories: MemoryEntry[] = [
        { id: 1, userId: 1, category: "test", content: "user likes coffee", importance: 5, lastAccessed: new Date(), accessCount: 1, createdAt: new Date() },
        { id: 2, userId: 1, category: "test", content: "meeting scheduled for friday", importance: 5, lastAccessed: new Date(), accessCount: 1, createdAt: new Date() }
      ];
      
      const duplicates = findDuplicates(memories, 0.7);
      expect(duplicates).toHaveLength(0);
    });

    it("handles empty array", () => {
      const duplicates = findDuplicates([], 0.7);
      expect(duplicates).toHaveLength(0);
    });

    it("handles single item array", () => {
      const memories: MemoryEntry[] = [
        { id: 1, userId: 1, category: "test", content: "hello", importance: 5, lastAccessed: new Date(), accessCount: 1, createdAt: new Date() }
      ];
      const duplicates = findDuplicates(memories, 0.7);
      expect(duplicates).toHaveLength(0);
    });
  });
});
