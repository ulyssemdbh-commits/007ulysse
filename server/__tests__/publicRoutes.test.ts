import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Ensures the declarative public route registry stays in sync.
 * If someone adds a new public route prefix, they should also add
 * an entry in PUBLIC_ROUTE_PREFIXES so auth bypass is explicit.
 */
describe("public routes consistency", () => {
  const routesSource = fs.readFileSync(
    path.join(__dirname, "../routes.ts"),
    "utf-8"
  );

  it("should have PUBLIC_ROUTE_PREFIXES as ReadonlyArray", () => {
    expect(routesSource).toContain("const PUBLIC_ROUTE_PREFIXES: ReadonlyArray<string>");
  });

  it("should have PUBLIC_ROUTE_EXACT as ReadonlyArray", () => {
    expect(routesSource).toContain("const PUBLIC_ROUTE_EXACT: ReadonlyArray<string>");
  });

  it("should check all three lists in the middleware", () => {
    expect(routesSource).toContain("PUBLIC_ROUTE_PREFIXES.some");
    expect(routesSource).toContain("PUBLIC_ROUTE_EXACT.includes");
    expect(routesSource).toContain("PUBLIC_ROUTE_INCLUDES.some");
  });

  it("should call requireAuth for non-public routes", () => {
    expect(routesSource).toContain("return requireAuth(req, res, next)");
  });

  it("should not contain switch/case for route auth bypass", () => {
    // Ensure no one regresses to the old if/else chain
    const authMiddlewareSection = routesSource.slice(
      routesSource.indexOf("PUBLIC_ROUTE_PREFIXES"),
      routesSource.indexOf("return requireAuth")
    );
    expect(authMiddlewareSection).not.toContain("switch");
    expect(authMiddlewareSection).not.toMatch(/else\s+if/);
  });

  it("health endpoint should be in public prefixes", () => {
    expect(routesSource).toMatch(/["']\/health["']/);
  });

  it("auth routes should be registered before the auth middleware", () => {
    const authRouteRegistration = routesSource.indexOf('app.use("/api/auth", authRoutes)');
    const publicRouteMiddleware = routesSource.indexOf("PUBLIC_ROUTE_PREFIXES");
    expect(authRouteRegistration).toBeLessThan(publicRouteMiddleware);
  });
});
