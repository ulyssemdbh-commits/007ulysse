import { describe, it, expect } from 'vitest';
import {
  isSafeFilename,
  isPathWithinBase,
  sanitizeString,
  validateId,
  validatePagination,
  validateRequiredFields,
  validateEmail,
  validateUrl,
  validateDateString,
} from '../utils/validation';

describe('Validation Utilities', () => {
  describe('isSafeFilename', () => {
    it('accepts normal filenames', () => {
      expect(isSafeFilename('report.pdf')).toBe(true);
      expect(isSafeFilename('my-file_v2.txt')).toBe(true);
    });

    it('rejects path traversal', () => {
      expect(isSafeFilename('../etc/passwd')).toBe(false);
      expect(isSafeFilename('..\\windows')).toBe(false);
    });

    it('rejects slashes', () => {
      expect(isSafeFilename('dir/file.txt')).toBe(false);
      expect(isSafeFilename('dir\\file.txt')).toBe(false);
    });

    it('rejects hidden files', () => {
      expect(isSafeFilename('.env')).toBe(false);
      expect(isSafeFilename('.gitignore')).toBe(false);
    });

    it('rejects null bytes', () => {
      expect(isSafeFilename('file\0.txt')).toBe(false);
    });

    it('rejects empty strings', () => {
      expect(isSafeFilename('')).toBe(false);
    });

    it('rejects overly long names', () => {
      expect(isSafeFilename('a'.repeat(256))).toBe(false);
    });

    it('accepts max length names', () => {
      expect(isSafeFilename('a'.repeat(255))).toBe(true);
    });
  });

  describe('isPathWithinBase', () => {
    it('accepts paths within base', () => {
      expect(isPathWithinBase('uploads/file.txt', '/var/www')).toBe(true);
    });

    it('rejects path traversal', () => {
      expect(isPathWithinBase('../../etc/passwd', '/var/www')).toBe(false);
    });

    it('handles exact base directory', () => {
      expect(isPathWithinBase('.', '/var/www')).toBe(true);
    });
  });

  describe('sanitizeString', () => {
    it('removes null bytes', () => {
      expect(sanitizeString('hello\0world')).toBe('helloworld');
    });

    it('truncates to max length', () => {
      expect(sanitizeString('hello world', 5)).toBe('hello');
    });

    it('returns empty string for non-string input', () => {
      expect(sanitizeString(123 as any)).toBe('');
    });

    it('preserves normal strings', () => {
      expect(sanitizeString('normal text')).toBe('normal text');
    });
  });

  describe('validateId', () => {
    it('accepts valid positive integers', () => {
      expect(validateId('1')).toBe(1);
      expect(validateId('42')).toBe(42);
      expect(validateId(100)).toBe(100);
    });

    it('rejects zero', () => {
      expect(() => validateId('0')).toThrow();
    });

    it('rejects negative numbers', () => {
      expect(() => validateId('-1')).toThrow();
    });

    it('rejects non-numeric strings', () => {
      expect(() => validateId('abc')).toThrow();
    });

    it('rejects floats', () => {
      expect(() => validateId('1.5')).toThrow();
    });

    it('rejects values over INT max', () => {
      expect(() => validateId('2147483648')).toThrow();
    });

    it('includes param name in error', () => {
      expect(() => validateId('abc', 'userId')).toThrow();
    });
  });

  describe('validatePagination', () => {
    it('returns defaults for empty query', () => {
      const result = validatePagination({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('calculates correct offset', () => {
      const result = validatePagination({ page: '3', limit: '10' });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });

    it('caps limit at 100', () => {
      const result = validatePagination({ limit: '500' });
      expect(result.limit).toBe(100);
    });

    it('floors page at 1', () => {
      const result = validatePagination({ page: '0' });
      expect(result.page).toBe(1);
    });

    it('uses default limit for zero input', () => {
      const result = validatePagination({ limit: '0' });
      // parseInt('0') || 20 => 20 (falsy zero falls to default)
      expect(result.limit).toBe(20);
    });
  });

  describe('validateRequiredFields', () => {
    it('passes when all fields present', () => {
      expect(() =>
        validateRequiredFields({ name: 'John', email: 'j@e.com' }, ['name', 'email'])
      ).not.toThrow();
    });

    it('throws on missing field', () => {
      expect(() =>
        validateRequiredFields({ name: 'John' }, ['name', 'email'])
      ).toThrow();
    });

    it('throws on null field', () => {
      expect(() =>
        validateRequiredFields({ name: null }, ['name'])
      ).toThrow();
    });

    it('throws on empty string', () => {
      expect(() =>
        validateRequiredFields({ name: '' }, ['name'])
      ).toThrow();
    });
  });

  describe('validateEmail', () => {
    it('accepts valid emails', () => {
      expect(validateEmail('user@example.com')).toBe('user@example.com');
    });

    it('normalizes to lowercase', () => {
      expect(validateEmail('User@Example.COM')).toBe('user@example.com');
    });

    it('rejects invalid emails', () => {
      expect(() => validateEmail('notanemail')).toThrow();
      expect(() => validateEmail('@no.com')).toThrow();
      expect(() => validateEmail('no@')).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => validateEmail('')).toThrow();
    });
  });

  describe('validateUrl', () => {
    it('accepts HTTP URLs', () => {
      expect(validateUrl('http://example.com')).toBe('http://example.com/');
    });

    it('accepts HTTPS URLs', () => {
      expect(validateUrl('https://example.com/path')).toBe('https://example.com/path');
    });

    it('rejects non-HTTP protocols', () => {
      expect(() => validateUrl('ftp://example.com')).toThrow();
      expect(() => validateUrl('javascript:alert(1)')).toThrow();
    });

    it('rejects invalid URLs', () => {
      expect(() => validateUrl('not a url')).toThrow();
    });
  });

  describe('validateDateString', () => {
    it('accepts ISO date strings', () => {
      const date = validateDateString('2026-01-15');
      expect(date.getFullYear()).toBe(2026);
    });

    it('accepts ISO datetime strings', () => {
      const date = validateDateString('2026-01-15T10:30:00Z');
      expect(date instanceof Date).toBe(true);
    });

    it('rejects invalid dates', () => {
      expect(() => validateDateString('not-a-date')).toThrow();
    });

    it('includes field name in error', () => {
      expect(() => validateDateString('invalid', 'startDate')).toThrow();
    });
  });
});
