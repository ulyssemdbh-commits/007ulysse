/**
 * Input Validation Utilities
 * 
 * Centralized validation functions for request parameters,
 * query strings, and body payloads across all API routes.
 */

import { Request, Response, NextFunction } from "express";
import { ValidationError } from "../utils/errors";

// ============================================================================
// Path & File Validation
// ============================================================================

/**
 * Validate that a filename is safe (no path traversal)
 */
export function isSafeFilename(filename: string): boolean {
    if (!filename || typeof filename !== 'string') return false;
    if (filename.length > 255) return false;
    if (filename.includes('..')) return false;
    if (filename.includes('/') || filename.includes('\\')) return false;
    if (filename.includes('\0')) return false;
    // Block hidden files
    if (filename.startsWith('.')) return false;
    return true;
}

/**
 * Validate a path stays within a base directory
 */
export function isPathWithinBase(filePath: string, baseDir: string): boolean {
    const path = require('path');
    const resolved = path.resolve(baseDir, filePath);
    const base = path.resolve(baseDir);
    return resolved.startsWith(base + path.sep) || resolved === base;
}

// ============================================================================
// String Validation
// ============================================================================

/**
 * Sanitize a string for safe database storage (prevent injection)
 */
export function sanitizeString(input: string, maxLength = 10000): string {
    if (typeof input !== 'string') return '';
    return input
        .slice(0, maxLength)
        .replace(/\0/g, ''); // Remove null bytes
}

/**
 * Validate an ID parameter (must be positive integer)
 */
export function validateId(value: any, paramName = 'id'): number {
    const str = String(value).trim();
    if (!/^\d+$/.test(str)) {
        throw ValidationError.invalidFormat(paramName, 'positive integer');
    }
    const id = parseInt(str, 10);
    if (isNaN(id) || id <= 0 || id > 2147483647) {
        throw ValidationError.invalidFormat(paramName, 'positive integer');
    }
    return id;
}

/**
 * Validate pagination parameters
 */
export function validatePagination(query: any): { page: number; limit: number; offset: number } {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

/**
 * Validate that required fields exist in request body
 */
export function validateRequiredFields(
    body: Record<string, any>,
    fields: string[]
): void {
    for (const field of fields) {
        if (body[field] === undefined || body[field] === null || body[field] === '') {
            throw ValidationError.missingRequired(field);
        }
    }
}

// ============================================================================
// Email Validation
// ============================================================================

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function validateEmail(email: string): string {
    if (!email || !EMAIL_REGEX.test(email)) {
        throw ValidationError.invalidFormat('email', 'valid email address');
    }
    return email.toLowerCase().trim();
}

// ============================================================================
// URL Validation
// ============================================================================

export function validateUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol');
        }
        return parsed.toString();
    } catch {
        throw ValidationError.invalidFormat('url', 'valid HTTP/HTTPS URL');
    }
}

// ============================================================================
// Date Validation
// ============================================================================

export function validateDateString(dateStr: string, fieldName = 'date'): Date {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        throw ValidationError.invalidFormat(fieldName, 'ISO date string (YYYY-MM-DD or ISO 8601)');
    }
    return date;
}

// ============================================================================
// Express Middleware Validators
// ============================================================================

/**
 * Middleware to validate that request body has required fields
 */
export function requireFields(...fields: string[]) {
    return (req: Request, _res: Response, next: NextFunction) => {
        try {
            validateRequiredFields(req.body, fields);
            next();
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Middleware to validate ID params
 */
export function validateIdParam(paramName = 'id') {
    return (req: Request, _res: Response, next: NextFunction) => {
        try {
            req.params[paramName] = String(validateId(req.params[paramName], paramName));
            next();
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Middleware to sanitize request body strings
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction) {
    if (req.body && typeof req.body === 'object') {
        for (const [key, value] of Object.entries(req.body)) {
            if (typeof value === 'string') {
                (req.body as any)[key] = sanitizeString(value);
            }
        }
    }
    next();
}
