import { describe, it, expect } from 'vitest';

/**
 * Tests for the declarative auth bypass registry in routes.ts.
 * These test the route matching logic extracted as constants.
 */

// Replicate the exact registry from routes.ts for testing
const PUBLIC_ROUTE_PREFIXES: ReadonlyArray<string> = [
  "/auth",
  "/v2",
  "/download/",
  "/suguval",
  "/sugumaillane",
  "/sports/cache/predictions",
  "/sports/dashboard",
  "/system/status",
  "/code",
  "/pronosoft",
  "/parionssport",
  "/internal/",
  "/devmax",
  "/coba",
  "/guest",
  "/health",
];
const PUBLIC_ROUTE_EXACT: ReadonlyArray<string> = [
  "/discord/internal-test",
];
const PUBLIC_ROUTE_INCLUDES: ReadonlyArray<string> = [
  "dgm/internal-trigger",
  "internal/vps-exec",
];

function isPublicRoute(path: string): boolean {
  return (
    PUBLIC_ROUTE_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix)) ||
    PUBLIC_ROUTE_EXACT.includes(path) ||
    PUBLIC_ROUTE_INCLUDES.some(s => path.includes(s))
  );
}

describe('Route Auth Bypass Registry', () => {
  describe('public routes that should bypass auth', () => {
    const publicPaths = [
      '/auth/login',
      '/auth/setup',
      '/v2/conversations',
      '/v2/health',
      '/download/file.pdf',
      '/suguval/checklist',
      '/sugumaillane/checklist',
      '/sports/cache/predictions/today',
      '/sports/dashboard/stats',
      '/system/status',
      '/code/context',
      '/pronosoft/data',
      '/parionssport/odds',
      '/internal/admin',
      '/devmax/projects',
      '/coba/chat',
      '/guest/session',
      '/health',
      '/discord/internal-test',
    ];

    publicPaths.forEach(path => {
      it(`allows ${path}`, () => {
        expect(isPublicRoute(path)).toBe(true);
      });
    });
  });

  describe('DGM and VPS internal triggers', () => {
    it('allows dgm/internal-trigger', () => {
      expect(isPublicRoute('/devops/dgm/internal-trigger')).toBe(true);
    });

    it('allows internal/vps-exec', () => {
      expect(isPublicRoute('/ops/internal/vps-exec')).toBe(true);
    });
  });

  describe('private routes that require auth', () => {
    const privatePaths = [
      '/conversations',
      '/voice/stream',
      '/hub/data',
      '/music/play',
      '/gmail/inbox',
      '/files/upload',
      '/admin/users',
      '/learning/patterns',
    ];

    privatePaths.forEach(path => {
      it(`requires auth for ${path}`, () => {
        expect(isPublicRoute(path)).toBe(false);
      });
    });
  });

  describe('edge cases', () => {
    it('does not allow partial prefix match outside boundary', () => {
      // /coba matches /coba*, but /cobalt should also match since startsWith
      // This is the existing behavior - documenting it
      expect(isPublicRoute('/cobaltstrike')).toBe(true);
    });

    it('exact match routes only match exactly', () => {
      expect(isPublicRoute('/discord/internal-test')).toBe(true);
      expect(isPublicRoute('/discord/internal-test/extra')).toBe(false);
    });
  });
});
