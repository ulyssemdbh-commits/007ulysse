import { describe, it, expect, vi, beforeEach } from "vitest";

interface Email {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: Date;
  isRead: boolean;
  labels: string[];
  attachments?: { name: string; size: number }[];
}

function extractEmailAddress(fromString: string): string {
  const match = fromString.match(/<([^>]+)>/);
  if (match) return match[1];
  if (fromString.includes("@")) return fromString.trim();
  return "";
}

function extractDomain(email: string): string {
  const parts = email.split("@");
  return parts.length === 2 ? parts[1].toLowerCase() : "";
}

function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

function categorizeEmail(email: Email): string {
  const subject = email.subject.toLowerCase();
  const from = email.from.toLowerCase();
  
  if (subject.includes("newsletter") || subject.includes("abonnement")) return "newsletter";
  if (subject.includes("facture") || subject.includes("invoice")) return "finance";
  if (subject.includes("meeting") || subject.includes("réunion")) return "calendar";
  if (from.includes("noreply") || from.includes("no-reply")) return "automated";
  
  return "general";
}

function filterUnread(emails: Email[]): Email[] {
  return emails.filter(e => !e.isRead);
}

function searchEmails(emails: Email[], query: string): Email[] {
  const lowerQuery = query.toLowerCase();
  return emails.filter(e => 
    e.subject.toLowerCase().includes(lowerQuery) ||
    e.body.toLowerCase().includes(lowerQuery) ||
    e.from.toLowerCase().includes(lowerQuery)
  );
}

function sortByDate(emails: Email[], ascending: boolean = false): Email[] {
  return [...emails].sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime();
    return ascending ? diff : -diff;
  });
}

describe("Email Service", () => {
  describe("Email Address Extraction", () => {
    it("extracts email from formatted string", () => {
      expect(extractEmailAddress("John Doe <john@example.com>")).toBe("john@example.com");
    });

    it("returns plain email as-is", () => {
      expect(extractEmailAddress("john@example.com")).toBe("john@example.com");
    });

    it("returns empty for invalid input", () => {
      expect(extractEmailAddress("John Doe")).toBe("");
    });
  });

  describe("Domain Extraction", () => {
    it("extracts domain from email", () => {
      expect(extractDomain("user@example.com")).toBe("example.com");
      expect(extractDomain("admin@sub.domain.org")).toBe("sub.domain.org");
    });

    it("returns empty for invalid email", () => {
      expect(extractDomain("invalid")).toBe("");
    });
  });

  describe("Email Validation", () => {
    it("validates correct emails", () => {
      expect(isValidEmail("user@example.com")).toBe(true);
      expect(isValidEmail("user.name@domain.co.uk")).toBe(true);
    });

    it("rejects invalid emails", () => {
      expect(isValidEmail("invalid")).toBe(false);
      expect(isValidEmail("user@")).toBe(false);
      expect(isValidEmail("@domain.com")).toBe(false);
    });
  });

  describe("Email Categorization", () => {
    it("categorizes newsletters", () => {
      const email: Email = {
        id: "1", from: "news@site.com", to: ["me@mail.com"],
        subject: "Weekly Newsletter", body: "", date: new Date(),
        isRead: false, labels: []
      };
      expect(categorizeEmail(email)).toBe("newsletter");
    });

    it("categorizes finance emails", () => {
      const email: Email = {
        id: "1", from: "billing@company.com", to: ["me@mail.com"],
        subject: "Your Invoice #123", body: "", date: new Date(),
        isRead: false, labels: []
      };
      expect(categorizeEmail(email)).toBe("finance");
    });

    it("categorizes automated emails", () => {
      const email: Email = {
        id: "1", from: "noreply@service.com", to: ["me@mail.com"],
        subject: "Notification", body: "", date: new Date(),
        isRead: false, labels: []
      };
      expect(categorizeEmail(email)).toBe("automated");
    });
  });

  describe("Email Filtering", () => {
    const emails: Email[] = [
      { id: "1", from: "a@test.com", to: ["me@mail.com"], subject: "Test 1", body: "", date: new Date(), isRead: false, labels: [] },
      { id: "2", from: "b@test.com", to: ["me@mail.com"], subject: "Test 2", body: "", date: new Date(), isRead: true, labels: [] },
      { id: "3", from: "c@test.com", to: ["me@mail.com"], subject: "Test 3", body: "", date: new Date(), isRead: false, labels: [] },
    ];

    it("filters unread emails", () => {
      const unread = filterUnread(emails);
      expect(unread.length).toBe(2);
      expect(unread.every(e => !e.isRead)).toBe(true);
    });
  });

  describe("Email Search", () => {
    const emails: Email[] = [
      { id: "1", from: "alice@test.com", to: ["me@mail.com"], subject: "Project Update", body: "Details here", date: new Date(), isRead: false, labels: [] },
      { id: "2", from: "bob@test.com", to: ["me@mail.com"], subject: "Meeting Notes", body: "Summary", date: new Date(), isRead: true, labels: [] },
    ];

    it("searches by subject", () => {
      const results = searchEmails(emails, "project");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("1");
    });

    it("searches by sender", () => {
      const results = searchEmails(emails, "bob");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("2");
    });

    it("returns empty for no matches", () => {
      const results = searchEmails(emails, "xyz123");
      expect(results.length).toBe(0);
    });
  });

  describe("Email Sorting", () => {
    const emails: Email[] = [
      { id: "1", from: "a@test.com", to: ["me@mail.com"], subject: "Old", body: "", date: new Date("2026-01-01"), isRead: false, labels: [] },
      { id: "2", from: "b@test.com", to: ["me@mail.com"], subject: "New", body: "", date: new Date("2026-01-15"), isRead: true, labels: [] },
    ];

    it("sorts by date descending by default", () => {
      const sorted = sortByDate(emails);
      expect(sorted[0].id).toBe("2");
    });

    it("sorts by date ascending when specified", () => {
      const sorted = sortByDate(emails, true);
      expect(sorted[0].id).toBe("1");
    });
  });
});
