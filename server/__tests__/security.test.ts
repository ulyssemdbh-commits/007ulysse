import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isAllowedOrigin,
  configureCORS,
  configureSessionSecurity,
  createLimiter,
} from '../middleware/security';

describe('Security Middleware', () => {
  describe('isAllowedOrigin', () => {
    it('allows undefined origin (same-origin requests)', () => {
      expect(isAllowedOrigin(undefined)).toBe(true);
    });

    it('allows ulysseproject.org', () => {
      expect(isAllowedOrigin('https://ulysseproject.org')).toBe(true);
    });

    it('allows ulyssepro.org', () => {
      expect(isAllowedOrigin('https://ulyssepro.org')).toBe(true);
    });

    it('allows subdomains of ulyssepro.org', () => {
      expect(isAllowedOrigin('https://app.ulyssepro.org')).toBe(true);
    });

    it('allows www.ulysseproject.org', () => {
      expect(isAllowedOrigin('https://www.ulysseproject.org')).toBe(true);
    });

    it('rejects unknown origins in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('https://evil.com')).toBe(false);
      process.env.NODE_ENV = originalEnv;
    });

    it('allows any origin in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      expect(isAllowedOrigin('https://evil.com')).toBe(true);
      process.env.NODE_ENV = originalEnv;
    });

    it('respects ALLOWED_ORIGINS env variable', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalAllowed = process.env.ALLOWED_ORIGINS;
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'custom-domain.com,another.io';
      expect(isAllowedOrigin('https://custom-domain.com')).toBe(true);
      expect(isAllowedOrigin('https://another.io')).toBe(true);
      process.env.NODE_ENV = originalEnv;
      process.env.ALLOWED_ORIGINS = originalAllowed;
    });
  });

  describe('configureSessionSecurity', () => {
    it('returns valid session config', () => {
      const config = configureSessionSecurity();
      expect(config.name).toBe('devflow.sid');
      expect(config.cookie.httpOnly).toBe(true);
      expect(config.cookie.sameSite).toBe('lax');
      expect(config.resave).toBe(false);
      expect(config.saveUninitialized).toBe(false);
    });

    it('sets secure cookie in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const config = configureSessionSecurity();
      expect(config.cookie.secure).toBe(true);
      process.env.NODE_ENV = originalEnv;
    });

    it('sets insecure cookie in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const config = configureSessionSecurity();
      expect(config.cookie.secure).toBe(false);
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('configureCORS', () => {
    it('returns valid CORS config with credentials', () => {
      const config = configureCORS();
      expect(config.credentials).toBe(true);
      expect(config.methods).toContain('GET');
      expect(config.methods).toContain('POST');
      expect(config.methods).toContain('DELETE');
      expect(config.allowedHeaders).toContain('Content-Type');
      expect(config.allowedHeaders).toContain('Authorization');
    });

    it('origin callback allows valid origins', () => {
      const config = configureCORS();
      const callback = vi.fn();
      (config.origin as Function)('https://ulyssepro.org', callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('origin callback rejects invalid origins in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const config = configureCORS();
      const callback = vi.fn();
      (config.origin as Function)('https://malicious.com', callback);
      expect(callback).toHaveBeenCalledWith(expect.any(Error));
      process.env.NODE_ENV = originalEnv;
    });
  });
});
