/**
 * Centralized Error Handling Middleware
 * 
 * Uses the standardized UlysseError classes from utils/errors.ts
 * to provide consistent API error responses across all routes.
 */

import { Request, Response, NextFunction } from "express";
import {
    UlysseError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    formatErrorResponse
} from "../utils/errors";

/**
 * Async wrapper - catches async errors and passes to error middleware
 * Usage: app.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * 404 handler for unknown routes
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
    // Don't handle non-API routes (let Vite/static serve them)
    if (!req.path.startsWith('/api')) {
        return next();
    }

    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: `Route not found: ${req.method} ${req.path}`,
        }
    });
}

/**
 * Global error handler middleware
 * Must be registered LAST after all routes
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
    // Don't send anything if headers already sent
    if (res.headersSent) {
        console.error('[ErrorHandler] Headers already sent, cannot respond:', err.message);
        return;
    }

    // Use standardized error formatting
    const formatted = formatErrorResponse(err);

    // Log the error with appropriate severity
    if (formatted.statusCode >= 500) {
        console.error(
            `[ErrorHandler] ${formatted.statusCode} ${formatted.code} on ${req.method} ${req.path}:`,
            err.stack || err.message
        );
    } else if (formatted.statusCode >= 400) {
        console.warn(
            `[ErrorHandler] ${formatted.statusCode} ${formatted.code} on ${req.method} ${req.path}: ${err.message}`
        );
    }

    // Build response (hide internals in production)
    const isProduction = process.env.NODE_ENV === 'production';

    const response: Record<string, any> = {
        error: {
            code: formatted.code,
            message: formatted.message,
        }
    };

    // Include context in development for debugging
    if (!isProduction && formatted.context) {
        response.error.context = formatted.context;
    }

    // Include stack trace in development for 500 errors
    if (!isProduction && formatted.statusCode >= 500 && err.stack) {
        response.error.stack = err.stack.split('\n').slice(0, 5);
    }

    res.status(formatted.statusCode).json(response);
}

/**
 * Standardized API response helpers
 */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200) {
    res.status(statusCode).json({ success: true, data });
}

export function sendCreated<T>(res: Response, data: T) {
    res.status(201).json({ success: true, data });
}

export function sendNoContent(res: Response) {
    res.status(204).send();
}

export function sendPaginated<T>(
    res: Response,
    data: T[],
    total: number,
    page: number,
    limit: number
) {
    res.status(200).json({
        success: true,
        data,
        pagination: {
            total,
            page,
            limit,
            pages: Math.ceil(total / limit),
            hasMore: page * limit < total,
        }
    });
}
