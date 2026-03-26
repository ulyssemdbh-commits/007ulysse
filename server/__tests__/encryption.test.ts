import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encryptionService } from "../services/encryption";

describe("Encryption Service - Real Implementation", () => {
  const originalEnv = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-32chars";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  describe("encrypt and decrypt", () => {
    it("encrypts and decrypts text correctly", () => {
      const original = "Hello, World!";
      const encrypted = encryptionService.encrypt(original);
      const decrypted = encryptionService.decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it("produces different ciphertext for same plaintext", () => {
      const text = "Same text";
      const encrypted1 = encryptionService.encrypt(text);
      const encrypted2 = encryptionService.encrypt(text);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("handles unicode text", () => {
      const original = "Héllo, 世界! 🌍";
      const encrypted = encryptionService.encrypt(original);
      const decrypted = encryptionService.decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it("handles empty string", () => {
      const original = "";
      const encrypted = encryptionService.encrypt(original);
      const decrypted = encryptionService.decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it("handles long text", () => {
      const original = "A".repeat(10000);
      const encrypted = encryptionService.encrypt(original);
      const decrypted = encryptionService.decrypt(encrypted);
      expect(decrypted).toBe(original);
    });
  });

  describe("isEncrypted", () => {
    it("identifies encrypted strings", () => {
      const encrypted = encryptionService.encrypt("test");
      expect(encryptionService.isEncrypted(encrypted)).toBe(true);
    });

    it("rejects non-encrypted strings", () => {
      expect(encryptionService.isEncrypted("plain text")).toBe(false);
      expect(encryptionService.isEncrypted("short:text")).toBe(false);
    });

    it("rejects malformed encrypted strings", () => {
      expect(encryptionService.isEncrypted("a:b:c")).toBe(false);
    });
  });

  describe("generateKey", () => {
    it("generates 32-byte hex key", () => {
      const key = encryptionService.generateKey();
      expect(key.length).toBe(64);
      expect(/^[0-9a-f]+$/i.test(key)).toBe(true);
    });

    it("generates unique keys", () => {
      const key1 = encryptionService.generateKey();
      const key2 = encryptionService.generateKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("error handling", () => {
    it("throws on invalid encrypted format", () => {
      expect(() => encryptionService.decrypt("invalid")).toThrow("Invalid encrypted data format");
    });

    it("throws when ENCRYPTION_KEY is missing", () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => encryptionService.encrypt("test")).toThrow("ENCRYPTION_KEY");
    });
  });
});
