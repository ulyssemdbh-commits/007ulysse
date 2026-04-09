import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSessionToken } from '../middleware/auth';

describe('Auth Middleware', () => {
  describe('getSessionToken', () => {
    it('extracts token from cookie', () => {
      const req = {
        cookies: { ulysse_session: 'test-token-123' },
        headers: {},
      } as any;
      expect(getSessionToken(req)).toBe('test-token-123');
    });

    it('extracts token from Bearer header', () => {
      const req = {
        cookies: {},
        headers: { authorization: 'Bearer my-jwt-token' },
      } as any;
      expect(getSessionToken(req)).toBe('my-jwt-token');
    });

    it('prefers cookie over header', () => {
      const req = {
        cookies: { ulysse_session: 'cookie-token' },
        headers: { authorization: 'Bearer header-token' },
      } as any;
      expect(getSessionToken(req)).toBe('cookie-token');
    });

    it('returns null when no token present', () => {
      const req = {
        cookies: {},
        headers: {},
      } as any;
      expect(getSessionToken(req)).toBeNull();
    });

    it('returns null for non-Bearer auth header', () => {
      const req = {
        cookies: {},
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      } as any;
      expect(getSessionToken(req)).toBeNull();
    });

    it('handles undefined cookies gracefully', () => {
      const req = {
        cookies: undefined,
        headers: {},
      } as any;
      expect(getSessionToken(req)).toBeNull();
    });
  });
});
