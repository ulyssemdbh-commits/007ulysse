import { describe, it, expect, vi, beforeEach } from "vitest";

interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface Conversation {
  id: number;
  userId: number;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

function generateTitle(messages: Message[]): string {
  const userMessages = messages.filter(m => m.role === "user");
  if (userMessages.length === 0) return "Nouvelle conversation";
  
  const firstMessage = userMessages[0].content;
  if (firstMessage.length <= 50) return firstMessage;
  return firstMessage.slice(0, 47) + "...";
}

function countTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

function truncateHistory(messages: Message[], maxTokens: number): Message[] {
  const result: Message[] = [];
  let tokenCount = 0;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = countTokens(messages[i].content);
    if (tokenCount + msgTokens > maxTokens) break;
    result.unshift(messages[i]);
    tokenCount += msgTokens;
  }
  
  return result;
}

function formatForAPI(messages: Message[]): { role: string; content: string }[] {
  return messages.map(m => ({
    role: m.role,
    content: m.content,
  }));
}

function getLastUserMessage(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

function extractMentions(content: string): string[] {
  const matches = content.match(/@(\w+)/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1));
}

describe("Conversation Service", () => {
  describe("Title Generation", () => {
    it("generates title from first user message", () => {
      const messages: Message[] = [
        { id: 1, role: "user", content: "Hello, how are you?", timestamp: new Date() },
      ];
      expect(generateTitle(messages)).toBe("Hello, how are you?");
    });

    it("truncates long messages", () => {
      const messages: Message[] = [
        { id: 1, role: "user", content: "This is a very long message that should be truncated because it exceeds the maximum length", timestamp: new Date() },
      ];
      const title = generateTitle(messages);
      expect(title.length).toBeLessThanOrEqual(50);
      expect(title.endsWith("...")).toBe(true);
    });

    it("returns default for empty messages", () => {
      expect(generateTitle([])).toBe("Nouvelle conversation");
    });

    it("skips assistant messages", () => {
      const messages: Message[] = [
        { id: 1, role: "assistant", content: "Hi there!", timestamp: new Date() },
        { id: 2, role: "user", content: "My question", timestamp: new Date() },
      ];
      expect(generateTitle(messages)).toBe("My question");
    });
  });

  describe("Token Counting", () => {
    it("estimates tokens for text", () => {
      const tokens = countTokens("Hello world");
      expect(tokens).toBeGreaterThan(0);
    });

    it("handles empty text", () => {
      const tokens = countTokens("");
      expect(tokens).toBeGreaterThanOrEqual(1);
    });

    it("scales with text length", () => {
      const short = countTokens("Hello");
      const long = countTokens("Hello world this is a longer message");
      expect(long).toBeGreaterThan(short);
    });
  });

  describe("History Truncation", () => {
    it("keeps recent messages within token limit", () => {
      const messages: Message[] = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message number ${i} with some content`,
        timestamp: new Date(),
      })) as Message[];
      
      const truncated = truncateHistory(messages, 100);
      expect(truncated.length).toBeLessThan(messages.length);
    });

    it("prioritizes most recent messages", () => {
      const messages: Message[] = [
        { id: 1, role: "user", content: "First", timestamp: new Date() },
        { id: 2, role: "assistant", content: "Second", timestamp: new Date() },
        { id: 3, role: "user", content: "Third", timestamp: new Date() },
      ];
      const truncated = truncateHistory(messages, 10);
      expect(truncated[truncated.length - 1].id).toBe(3);
    });
  });

  describe("API Formatting", () => {
    it("formats messages for API", () => {
      const messages: Message[] = [
        { id: 1, role: "user", content: "Hello", timestamp: new Date(), metadata: { source: "web" } },
      ];
      const formatted = formatForAPI(messages);
      expect(formatted[0]).toEqual({ role: "user", content: "Hello" });
      expect(formatted[0]).not.toHaveProperty("metadata");
    });
  });

  describe("Last User Message", () => {
    it("finds last user message", () => {
      const messages: Message[] = [
        { id: 1, role: "user", content: "First", timestamp: new Date() },
        { id: 2, role: "assistant", content: "Response", timestamp: new Date() },
        { id: 3, role: "user", content: "Second", timestamp: new Date() },
        { id: 4, role: "assistant", content: "Response 2", timestamp: new Date() },
      ];
      const last = getLastUserMessage(messages);
      expect(last?.id).toBe(3);
    });

    it("returns null for no user messages", () => {
      const messages: Message[] = [
        { id: 1, role: "assistant", content: "Hi", timestamp: new Date() },
      ];
      expect(getLastUserMessage(messages)).toBeNull();
    });
  });

  describe("Mention Extraction", () => {
    it("extracts mentions from content", () => {
      const mentions = extractMentions("Hello @alice and @bob");
      expect(mentions).toContain("alice");
      expect(mentions).toContain("bob");
    });

    it("returns empty array for no mentions", () => {
      expect(extractMentions("Hello world")).toEqual([]);
    });
  });
});
