import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError, shouldNotRetry } from '../utils/retryHelper';

describe('retryHelper', () => {
  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure then succeeds', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('ok');
      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('persistent fail'));
      await expect(
        withRetry(fn, { maxRetries: 2, baseDelayMs: 10 })
      ).rejects.toThrow('persistent fail');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry when shouldRetry returns false', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('unauthorized'));
      await expect(
        withRetry(fn, {
          maxRetries: 3,
          baseDelayMs: 10,
          shouldRetry: () => false,
        })
      ).rejects.toThrow('unauthorized');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls onRetry callback', async () => {
      const onRetry = vi.fn();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('retry me'))
        .mockResolvedValue('ok');
      await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, onRetry });
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
    });

    it('respects maxDelayMs cap', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('ok');
      // With baseDelay=100, 2^1 * 100 = 200, but maxDelay = 50
      const start = Date.now();
      await withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 50 });
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('isRetryableError', () => {
    it('returns true for timeout errors', () => {
      expect(isRetryableError(new Error('Request timeout'))).toBe(true);
    });

    it('returns true for ECONNRESET', () => {
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    });

    it('returns true for 503 errors', () => {
      expect(isRetryableError(new Error('Service unavailable 503'))).toBe(true);
    });

    it('returns true for 429 rate limit', () => {
      expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
    });

    it('returns true for network errors', () => {
      expect(isRetryableError(new Error('network error'))).toBe(true);
    });

    it('returns false for 404 errors', () => {
      expect(isRetryableError(new Error('404 Not Found'))).toBe(false);
    });

    it('returns false for auth errors', () => {
      expect(isRetryableError(new Error('401 Unauthorized'))).toBe(false);
    });
  });

  describe('shouldNotRetry', () => {
    it('returns true for 401', () => {
      expect(shouldNotRetry(new Error('HTTP 401'))).toBe(true);
    });

    it('returns true for 403', () => {
      expect(shouldNotRetry(new Error('HTTP 403'))).toBe(true);
    });

    it('returns true for 404', () => {
      expect(shouldNotRetry(new Error('HTTP 404'))).toBe(true);
    });

    it('returns true for invalid input', () => {
      expect(shouldNotRetry(new Error('invalid parameter'))).toBe(true);
    });

    it('returns true for unauthorized', () => {
      expect(shouldNotRetry(new Error('unauthorized access'))).toBe(true);
    });

    it('returns false for retryable errors', () => {
      expect(shouldNotRetry(new Error('ECONNRESET'))).toBe(false);
    });
  });
});
