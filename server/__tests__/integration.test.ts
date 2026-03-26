/**
 * Integration Tests - Critical Security & Infrastructure
 * 
 * Tests for the fixes applied from the technical audit:
 * - Environment validation
 * - Path traversal protection
 * - Error handling middleware
 * - Input validation
 * - CORS configuration
 * - Database connection
 * - Service initialization
 */

import { describe, it, expect, beforeAll } from "vitest";

// ============================================================================
// 1. Environment Validation Tests
// ============================================================================

describe("Environment Validation", () => {
    it("should detect missing required vars in production", async () => {
        const originalEnv = process.env.NODE_ENV;
        const originalJwt = process.env.JWT_SECRET;

        process.env.NODE_ENV = "production";
        delete process.env.JWT_SECRET;

        const { validateEnvironment } = await import("../config/envValidation");
        const result = validateEnvironment();

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('JWT_SECRET'))).toBe(true);

        // Restore
        process.env.NODE_ENV = originalEnv;
        if (originalJwt) process.env.JWT_SECRET = originalJwt;
    });

    it("should pass in development with defaults", async () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "development";

        const { validateEnvironment } = await import("../config/envValidation");
        const result = validateEnvironment();

        expect(result.valid).toBe(true);

        process.env.NODE_ENV = originalEnv;
    });

    it("should detect weak JWT secrets in production", async () => {
        const originalEnv = process.env.NODE_ENV;
        const originalJwt = process.env.JWT_SECRET;

        process.env.NODE_ENV = "production";
        process.env.JWT_SECRET = "dev-secret-key-change-in-production-18234791";
        // Also need DATABASE_URL, OWNER_CODE_PIN, ENCRYPTION_KEY for production
        process.env.DATABASE_URL = "postgresql://test@localhost/test";
        process.env.OWNER_CODE_PIN = "1234";
        process.env.ENCRYPTION_KEY = "test-key";

        const { validateEnvironment } = await import("../config/envValidation");
        const result = validateEnvironment();

        expect(result.errors.some(e => e.includes('JWT_SECRET'))).toBe(true);

        // Restore
        process.env.NODE_ENV = originalEnv;
        if (originalJwt) process.env.JWT_SECRET = originalJwt;
    });

    it("should apply default values", async () => {
        const originalPort = process.env.PORT;
        delete process.env.PORT;

        const { validateEnvironment } = await import("../config/envValidation");
        validateEnvironment();

        expect(process.env.PORT).toBe("5000");

        // Restore
        if (originalPort) process.env.PORT = originalPort;
    });
});

// ============================================================================
// 2. Path Traversal Protection Tests
// ============================================================================

describe("Path Traversal Protection", () => {
    it("should block .. in filenames", () => {
        const { isSafeFilename } = require("../utils/validation");

        expect(isSafeFilename("../../../etc/passwd")).toBe(false);
        expect(isSafeFilename("..\\..\\windows\\system32")).toBe(false);
        expect(isSafeFilename("test/../../../.env")).toBe(false);
    });

    it("should block forward slashes", () => {
        const { isSafeFilename } = require("../utils/validation");

        expect(isSafeFilename("path/to/file")).toBe(false);
        expect(isSafeFilename("path\\to\\file")).toBe(false);
    });

    it("should block null bytes", () => {
        const { isSafeFilename } = require("../utils/validation");

        expect(isSafeFilename("test\0.txt")).toBe(false);
    });

    it("should block hidden files", () => {
        const { isSafeFilename } = require("../utils/validation");

        expect(isSafeFilename(".env")).toBe(false);
        expect(isSafeFilename(".htaccess")).toBe(false);
    });

    it("should allow valid filenames", () => {
        const { isSafeFilename } = require("../utils/validation");

        expect(isSafeFilename("document.pdf")).toBe(true);
        expect(isSafeFilename("photo-2026.jpg")).toBe(true);
        expect(isSafeFilename("report_final_v2.xlsx")).toBe(true);
    });

    it("should validate path stays within base directory", () => {
        const { isPathWithinBase } = require("../utils/validation");
        const path = require("path");
        const baseDir = path.resolve("/downloads");

        expect(isPathWithinBase("file.txt", baseDir)).toBe(true);
        expect(isPathWithinBase("../../../etc/passwd", baseDir)).toBe(false);
    });
});

// ============================================================================
// 3. Input Validation Tests
// ============================================================================

describe("Input Validation", () => {
    it("should validate positive integer IDs", () => {
        const { validateId } = require("../utils/validation");

        expect(validateId("1")).toBe(1);
        expect(validateId("42")).toBe(42);
        expect(validateId("999999")).toBe(999999);

        expect(() => validateId("0")).toThrow();
        expect(() => validateId("-1")).toThrow();
        expect(() => validateId("abc")).toThrow();
        expect(() => validateId("3.14")).toThrow();
    });

    it("should validate pagination", () => {
        const { validatePagination } = require("../utils/validation");

        const result = validatePagination({ page: "2", limit: "10" });
        expect(result.page).toBe(2);
        expect(result.limit).toBe(10);
        expect(result.offset).toBe(10);
    });

    it("should cap pagination limit at 100", () => {
        const { validatePagination } = require("../utils/validation");

        const result = validatePagination({ page: "1", limit: "500" });
        expect(result.limit).toBe(100);
    });

    it("should validate email addresses", () => {
        const { validateEmail } = require("../utils/validation");

        expect(validateEmail("user@example.com")).toBe("user@example.com");
        expect(validateEmail("Test@Example.COM")).toBe("test@example.com");

        expect(() => validateEmail("not-an-email")).toThrow();
        expect(() => validateEmail("@missing.com")).toThrow();
        expect(() => validateEmail("")).toThrow();
    });

    it("should validate URLs", () => {
        const { validateUrl } = require("../utils/validation");

        expect(validateUrl("https://example.com")).toBe("https://example.com/");
        expect(validateUrl("http://localhost:3000/path")).toBe("http://localhost:3000/path");

        expect(() => validateUrl("ftp://not-allowed.com")).toThrow();
        expect(() => validateUrl("not-a-url")).toThrow();
    });

    it("should validate date strings", () => {
        const { validateDateString } = require("../utils/validation");

        const date = validateDateString("2026-02-08");
        expect(date).toBeInstanceOf(Date);

        expect(() => validateDateString("not-a-date")).toThrow();
    });

    it("should sanitize strings (remove null bytes)", () => {
        const { sanitizeString } = require("../utils/validation");

        expect(sanitizeString("hello\0world")).toBe("helloworld");
        expect(sanitizeString("normal text")).toBe("normal text");
    });

    it("should enforce max length on sanitized strings", () => {
        const { sanitizeString } = require("../utils/validation");

        const long = "a".repeat(20000);
        expect(sanitizeString(long, 100).length).toBe(100);
    });
});

// ============================================================================
// 4. Error Handling Tests
// ============================================================================

describe("Error Handling", () => {
    it("should format UlysseError correctly", () => {
        const { ValidationError, formatErrorResponse } = require("../utils/errors");

        const error = ValidationError.missingRequired("username");
        const response = formatErrorResponse(error);

        expect(response.statusCode).toBe(400);
        expect(response.code).toBe("VALIDATION_ERROR");
        expect(response.message).toContain("username");
    });

    it("should format database errors as 500", () => {
        const { DatabaseError, formatErrorResponse } = require("../utils/errors");

        const error = DatabaseError.connectionFailed(new Error("Connection refused"));
        const response = formatErrorResponse(error);

        expect(response.statusCode).toBe(500);
        expect(response.code).toBe("DB_ERROR");
    });

    it("should format integration errors as 502", () => {
        const { IntegrationError, formatErrorResponse } = require("../utils/errors");

        const error = IntegrationError.notAvailable("Spotify", "Not configured");
        const response = formatErrorResponse(error);

        expect(response.statusCode).toBe(502);
        expect(response.code).toBe("SPOTIFY_ERROR");
    });

    it("should format unknown errors safely", () => {
        const { formatErrorResponse } = require("../utils/errors");

        const response = formatErrorResponse(new Error("Something went wrong"));

        expect(response.statusCode).toBe(500);
        expect(response.code).toBe("UNKNOWN_ERROR");
        expect(response.message).toBe("Something went wrong");
    });

    it("should format non-Error objects", () => {
        const { formatErrorResponse } = require("../utils/errors");

        const response = formatErrorResponse("string error");

        expect(response.statusCode).toBe(500);
        expect(response.code).toBe("UNKNOWN_ERROR");
    });
});

// ============================================================================
// 5. CORS Configuration Tests
// ============================================================================

describe("CORS Configuration", () => {
    it("should allow ulysseproject.org origins", () => {
        const { isAllowedOrigin } = require("../middleware/security");

        expect(isAllowedOrigin("https://ulysseproject.org")).toBe(true);
        expect(isAllowedOrigin("https://www.ulysseproject.org")).toBe(true);
    });

    it("should allow custom origins via ALLOWED_ORIGINS env", () => {
        const originalOrigins = process.env.ALLOWED_ORIGINS;
        process.env.ALLOWED_ORIGINS = "https://custom-app.example.com";

        const { isAllowedOrigin } = require("../middleware/security");

        expect(isAllowedOrigin("https://custom-app.example.com")).toBe(true);

        if (originalOrigins) process.env.ALLOWED_ORIGINS = originalOrigins;
        else delete process.env.ALLOWED_ORIGINS;
    });

    it("should allow null/undefined origin (same-origin)", () => {
        const { isAllowedOrigin } = require("../middleware/security");

        expect(isAllowedOrigin(undefined)).toBe(true);
    });

    it("should block unknown origins in production", () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        const { isAllowedOrigin } = require("../middleware/security");

        expect(isAllowedOrigin("https://evil-site.com")).toBe(false);

        process.env.NODE_ENV = originalEnv;
    });
});

// ============================================================================
// 6. Integration Defaults Tests
// ============================================================================

describe("Integration Defaults", () => {
    it("should identify optional services", () => {
        const { isReplitIntegration } = require("../services/integrationDefaults");

        expect(isReplitIntegration("spotify")).toBe(true);
        expect(isReplitIntegration("notion")).toBe(true);
        expect(isReplitIntegration("todoist")).toBe(true);
        expect(isReplitIntegration("openai")).toBe(false);
    });

    it("should report unavailable when env vars missing", () => {
        const originalSpotifyId = process.env.SPOTIFY_CLIENT_ID;
        const originalSpotifySecret = process.env.SPOTIFY_CLIENT_SECRET;
        delete process.env.SPOTIFY_CLIENT_ID;
        delete process.env.SPOTIFY_CLIENT_SECRET;

        const { getIntegrationStatus } = require("../services/integrationDefaults");

        const status = getIntegrationStatus("spotify");
        expect(status.available).toBe(false);
        expect(status.reason).toContain("SPOTIFY_CLIENT_ID");

        if (originalSpotifyId) process.env.SPOTIFY_CLIENT_ID = originalSpotifyId;
        if (originalSpotifySecret) process.env.SPOTIFY_CLIENT_SECRET = originalSpotifySecret;
    });
});

// ============================================================================
// 7. Search Domain Detection Tests
// ============================================================================

describe("Search Domain Detection", () => {
    it("should detect sports queries", async () => {
        const { detectSearchDomain } = await import("../services/unifiedSearchRouter");

        expect(detectSearchDomain("classement ligue 1")).toBe("sports");
        expect(detectSearchDomain("score du match PSG")).toBe("sports");
        expect(detectSearchDomain("pronos champions league")).toBe("sports");
    });

    it("should detect trading queries", async () => {
        const { detectSearchDomain } = await import("../services/unifiedSearchRouter");

        expect(detectSearchDomain("cours bitcoin aujourd'hui")).toBe("trading");
        expect(detectSearchDomain("analyse trading crypto")).toBe("trading");
    });

    it("should detect weather queries", async () => {
        const { detectSearchDomain } = await import("../services/unifiedSearchRouter");

        expect(detectSearchDomain("météo marseille demain")).toBe("weather");
    });

    it("should default to general for unknown queries", async () => {
        const { detectSearchDomain } = await import("../services/unifiedSearchRouter");

        expect(detectSearchDomain("hello world")).toBe("general");
    });
});

// ============================================================================
// 8. Service Init Manager Tests
// ============================================================================

describe("Service Init Manager", () => {
    it("should initialize services in dependency order", async () => {
        const { ServiceInitManager } = await import("../config/serviceInit");

        const manager = new ServiceInitManager();
        const order: string[] = [];

        manager.register({
            name: "serviceA",
            init: async () => { order.push("A"); },
        });

        manager.register({
            name: "serviceB",
            dependsOn: ["serviceA"],
            init: async () => { order.push("B"); },
        });

        manager.register({
            name: "serviceC",
            dependsOn: ["serviceB"],
            init: async () => { order.push("C"); },
        });

        await manager.initializeAll();

        expect(order).toEqual(["A", "B", "C"]);
    });

    it("should skip services with unmet dependencies", async () => {
        const { ServiceInitManager } = await import("../config/serviceInit");

        const manager = new ServiceInitManager();

        manager.register({
            name: "serviceA",
            critical: false,
            init: async () => { throw new Error("fail"); },
        });

        manager.register({
            name: "serviceB",
            dependsOn: ["serviceA"],
            init: async () => { },
        });

        const results = await manager.initializeAll();

        const serviceB = results.find(r => r.name === "serviceB");
        expect(serviceB?.status).toBe("skipped");
    });

    it("should throw on critical service failure", async () => {
        const { ServiceInitManager } = await import("../config/serviceInit");

        const manager = new ServiceInitManager();

        manager.register({
            name: "criticalService",
            critical: true,
            init: async () => { throw new Error("critical failure"); },
        });

        await expect(manager.initializeAll()).rejects.toThrow("critical failure");
    });

    it("should handle service timeout", async () => {
        const { ServiceInitManager } = await import("../config/serviceInit");

        const manager = new ServiceInitManager();

        manager.register({
            name: "slowService",
            timeout: 100,
            init: async () => { await new Promise(r => setTimeout(r, 500)); },
        });

        const results = await manager.initializeAll();

        expect(results[0].status).toBe("timeout");
    });
});
