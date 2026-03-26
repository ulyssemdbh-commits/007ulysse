import { describe, it, expect, vi, beforeEach } from "vitest";

function validateEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 8) errors.push("At least 8 characters required");
  if (!/[A-Z]/.test(password)) errors.push("At least one uppercase letter required");
  if (!/[a-z]/.test(password)) errors.push("At least one lowercase letter required");
  if (!/[0-9]/.test(password)) errors.push("At least one number required");
  
  return { valid: errors.length === 0, errors };
}

function validateUsername(username: string): { valid: boolean; error?: string } {
  if (username.length < 3) return { valid: false, error: "Username too short" };
  if (username.length > 30) return { valid: false, error: "Username too long" };
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return { valid: false, error: "Invalid characters" };
  return { valid: true };
}

function sanitizeInput(input: string): string {
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}

function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function validatePhoneNumber(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, "");
  return /^\+?[0-9]{10,15}$/.test(cleaned);
}

function validateDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

function validateCoordinates(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

describe("Validation Utilities", () => {
  describe("Email Validation", () => {
    it("accepts valid emails", () => {
      expect(validateEmail("user@example.com")).toBe(true);
      expect(validateEmail("user.name@domain.co.uk")).toBe(true);
    });

    it("rejects invalid emails", () => {
      expect(validateEmail("invalid")).toBe(false);
      expect(validateEmail("user@")).toBe(false);
      expect(validateEmail("@domain.com")).toBe(false);
      expect(validateEmail("user @domain.com")).toBe(false);
    });
  });

  describe("Password Validation", () => {
    it("accepts strong passwords", () => {
      const result = validatePassword("SecurePass1");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects short passwords", () => {
      const result = validatePassword("Abc1");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("At least 8 characters required");
    });

    it("requires uppercase", () => {
      const result = validatePassword("lowercase1");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("uppercase"))).toBe(true);
    });

    it("requires number", () => {
      const result = validatePassword("NoNumbers");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("number"))).toBe(true);
    });
  });

  describe("Username Validation", () => {
    it("accepts valid usernames", () => {
      expect(validateUsername("john_doe").valid).toBe(true);
      expect(validateUsername("User123").valid).toBe(true);
    });

    it("rejects short usernames", () => {
      const result = validateUsername("ab");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("short");
    });

    it("rejects special characters", () => {
      const result = validateUsername("user@name");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid");
    });
  });

  describe("Input Sanitization", () => {
    it("escapes HTML entities", () => {
      expect(sanitizeInput("<script>")).toBe("&lt;script&gt;");
      expect(sanitizeInput('"test"')).toBe("&quot;test&quot;");
    });

    it("trims whitespace", () => {
      expect(sanitizeInput("  hello  ")).toBe("hello");
    });
  });

  describe("URL Validation", () => {
    it("accepts valid URLs", () => {
      expect(validateUrl("https://example.com")).toBe(true);
      expect(validateUrl("http://localhost:3000")).toBe(true);
    });

    it("rejects invalid URLs", () => {
      expect(validateUrl("not-a-url")).toBe(false);
      expect(validateUrl("ftp://example.com")).toBe(false);
    });
  });

  describe("Phone Validation", () => {
    it("accepts valid phone numbers", () => {
      expect(validatePhoneNumber("+33612345678")).toBe(true);
      expect(validatePhoneNumber("06 12 34 56 78")).toBe(true);
    });

    it("rejects invalid phone numbers", () => {
      expect(validatePhoneNumber("123")).toBe(false);
      expect(validatePhoneNumber("not-a-phone")).toBe(false);
    });
  });

  describe("Date Validation", () => {
    it("accepts valid dates", () => {
      expect(validateDate("2026-01-15")).toBe(true);
      expect(validateDate("January 15, 2026")).toBe(true);
    });

    it("rejects invalid dates", () => {
      expect(validateDate("not-a-date")).toBe(false);
    });
  });

  describe("Coordinate Validation", () => {
    it("accepts valid coordinates", () => {
      expect(validateCoordinates(48.8566, 2.3522)).toBe(true);
      expect(validateCoordinates(-90, 180)).toBe(true);
    });

    it("rejects out-of-range coordinates", () => {
      expect(validateCoordinates(91, 0)).toBe(false);
      expect(validateCoordinates(0, 181)).toBe(false);
    });
  });
});
