/**
 * Custom Error Classes for Ulysse
 * Standardized error handling across services
 */

/**
 * Base error class for all Ulysse-specific errors
 */
export class UlysseError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'UlysseError';
    Object.setPrototypeOf(this, UlysseError.prototype);
  }

  toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: process.env.NODE_ENV === 'development' ? this.stack : undefined
    };
  }
}

/**
 * Database-related errors
 */
export class DatabaseError extends UlysseError {
  constructor(
    message: string,
    context?: Record<string, any>
  ) {
    super('DB_ERROR', message, context);
    this.name = 'DatabaseError';
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }

  static connectionFailed(originalError: Error): DatabaseError {
    return new DatabaseError(
      `Failed to connect to database: ${originalError.message}`,
      { originalError: originalError.message }
    );
  }

  static queryFailed(query: string, originalError: Error): DatabaseError {
    return new DatabaseError(
      `Query execution failed: ${originalError.message}`,
      { query, originalError: originalError.message }
    );
  }

  static migrationFailed(migration: string, originalError: Error): DatabaseError {
    return new DatabaseError(
      `Migration failed: ${originalError.message}`,
      { migration, originalError: originalError.message }
    );
  }
}

/**
 * Validation-related errors
 */
export class ValidationError extends UlysseError {
  constructor(
    message: string,
    context?: Record<string, any>
  ) {
    super('VALIDATION_ERROR', message, context);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  static missingRequired(field: string): ValidationError {
    return new ValidationError(
      `Missing required field: ${field}`,
      { field }
    );
  }

  static invalidFormat(field: string, format: string): ValidationError {
    return new ValidationError(
      `Invalid format for ${field}. Expected: ${format}`,
      { field, format }
    );
  }

  static invalidRange(field: string, min?: number, max?: number): ValidationError {
    return new ValidationError(
      `${field} out of valid range: ${min}-${max}`,
      { field, min, max }
    );
  }
}

/**
 * External service integration errors
 */
export class IntegrationError extends UlysseError {
  constructor(
    public service: string,
    message: string,
    context?: Record<string, any>
  ) {
    super(`${service.toUpperCase()}_ERROR`, message, { service, ...context });
    this.name = 'IntegrationError';
    Object.setPrototypeOf(this, IntegrationError.prototype);
  }

  static notAvailable(service: string, reason: string): IntegrationError {
    return new IntegrationError(
      service,
      `${service} integration is not available: ${reason}`,
      { reason }
    );
  }

  static authenticationFailed(service: string, details?: string): IntegrationError {
    return new IntegrationError(
      service,
      `Authentication failed for ${service}${details ? ': ' + details : ''}`,
      { details }
    );
  }

  static requestFailed(
    service: string,
    endpoint: string,
    statusCode: number,
    originalError: Error
  ): IntegrationError {
    return new IntegrationError(
      service,
      `Request to ${service} ${endpoint} failed (${statusCode}): ${originalError.message}`,
      { endpoint, statusCode, originalError: originalError.message }
    );
  }

  static rateLimitExceeded(service: string, retryAfter?: number): IntegrationError {
    return new IntegrationError(
      service,
      `Rate limit exceeded for ${service}${retryAfter ? ` - retry after ${retryAfter}s` : ''}`,
      { retryAfter }
    );
  }
}

/**
 * Scraping-related errors
 */
export class ScraperError extends UlysseError {
  constructor(
    message: string,
    context?: Record<string, any>
  ) {
    super('SCRAPER_ERROR', message, context);
    this.name = 'ScraperError';
    Object.setPrototypeOf(this, ScraperError.prototype);
  }

  static urlFailed(url: string, statusCode: number, originalError?: Error): ScraperError {
    return new ScraperError(
      `Failed to scrape ${url} (${statusCode})${originalError ? ': ' + originalError.message : ''}`,
      { url, statusCode, originalError: originalError?.message }
    );
  }

  static verificationFailed(url: string, diffs: string[]): ScraperError {
    return new ScraperError(
      `Verification failed for ${url}: ${diffs.slice(0, 3).join('; ')}`,
      { url, diffs: diffs.slice(0, 3) }
    );
  }

  static timeoutExceeded(url: string, timeoutMs: number): ScraperError {
    return new ScraperError(
      `Timeout exceeded while scraping ${url} (${timeoutMs}ms)`,
      { url, timeoutMs }
    );
  }

  static invalidSelector(selector: string, reason: string): ScraperError {
    return new ScraperError(
      `Invalid selector "${selector}": ${reason}`,
      { selector, reason }
    );
  }
}

/**
 * Authentication and authorization errors
 */
export class AuthenticationError extends UlysseError {
  constructor(
    message: string,
    context?: Record<string, any>
  ) {
    super('AUTH_ERROR', message, context);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }

  static tokenInvalid(): AuthenticationError {
    return new AuthenticationError('Authentication token is invalid or expired');
  }

  static tokenExpired(): AuthenticationError {
    return new AuthenticationError('Authentication token has expired');
  }

  static credentialsMissing(): AuthenticationError {
    return new AuthenticationError('Required credentials are missing');
  }

  static passwordIncorrect(): AuthenticationError {
    return new AuthenticationError('Password is incorrect');
  }
}

/**
 * Permission/authorization errors
 */
export class AuthorizationError extends UlysseError {
  constructor(
    message: string,
    context?: Record<string, any>
  ) {
    super('AUTHZ_ERROR', message, context);
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }

  static insufficientPermissions(resource: string): AuthorizationError {
    return new AuthorizationError(
      `Insufficient permissions to access ${resource}`,
      { resource }
    );
  }

  static accessDenied(resource: string, reason: string): AuthorizationError {
    return new AuthorizationError(
      `Access denied to ${resource}: ${reason}`,
      { resource, reason }
    );
  }
}

/**
 * Resource not found errors
 */
export class NotFoundError extends UlysseError {
  constructor(
    resourceType: string,
    resourceId: string | number,
    context?: Record<string, any>
  ) {
    super(
      'NOT_FOUND',
      `${resourceType} not found: ${resourceId}`,
      { resourceType, resourceId, ...context }
    );
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Conflict/duplicate errors
 */
export class ConflictError extends UlysseError {
  constructor(
    message: string,
    context?: Record<string, any>
  ) {
    super('CONFLICT', message, context);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }

  static alreadyExists(resourceType: string, identifier: string): ConflictError {
    return new ConflictError(
      `${resourceType} already exists: ${identifier}`,
      { resourceType, identifier }
    );
  }
}

/**
 * Resource exhausted errors (quota, limits, capacity)
 */
export class ResourceExhaustedError extends UlysseError {
  constructor(
    resourceType: string,
    message: string,
    context?: Record<string, any>
  ) {
    super(
      'RESOURCE_EXHAUSTED',
      `${resourceType} limit exceeded: ${message}`,
      { resourceType, ...context }
    );
    this.name = 'ResourceExhaustedError';
    Object.setPrototypeOf(this, ResourceExhaustedError.prototype);
  }

  static quotaExceeded(service: string, quota: number): ResourceExhaustedError {
    return new ResourceExhaustedError(
      service,
      `Quota limit (${quota}) exceeded`,
      { quota }
    );
  }

  static rateLimitExceeded(service: string, retryAfter?: number): ResourceExhaustedError {
    return new ResourceExhaustedError(
      service,
      `Rate limit exceeded${retryAfter ? ` - retry after ${retryAfter}s` : ''}`,
      { retryAfter }
    );
  }
}

/**
 * Internal server errors
 */
export class InternalError extends UlysseError {
  constructor(
    message: string,
    originalError?: Error
  ) {
    super(
      'INTERNAL_ERROR',
      message,
      originalError ? { originalError: originalError.message, stack: originalError.stack } : undefined
    );
    this.name = 'InternalError';
    Object.setPrototypeOf(this, InternalError.prototype);
  }
}

/**
 * Type guard to check if error is UlysseError
 */
export function isUlysseError(error: unknown): error is UlysseError {
  return error instanceof UlysseError;
}

/**
 * Error handler utility for API responses
 */
export function formatErrorResponse(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
  context?: Record<string, any>;
} {
  if (error instanceof ValidationError) {
    return { statusCode: 400, code: error.code, message: error.message, context: error.context };
  }
  if (error instanceof AuthenticationError) {
    return { statusCode: 401, code: error.code, message: error.message, context: error.context };
  }
  if (error instanceof AuthorizationError) {
    return { statusCode: 403, code: error.code, message: error.message, context: error.context };
  }
  if (error instanceof NotFoundError) {
    return { statusCode: 404, code: error.code, message: error.message, context: error.context };
  }
  if (error instanceof ConflictError) {
    return { statusCode: 409, code: error.code, message: error.message, context: error.context };
  }
  if (error instanceof ResourceExhaustedError) {
    return { statusCode: 429, code: error.code, message: error.message, context: error.context };
  }
  if (error instanceof DatabaseError) {
    return { statusCode: 500, code: error.code, message: error.message, context: error.context };
  }
  if (error instanceof IntegrationError) {
    return { statusCode: 502, code: error.code, message: error.message, context: error.context };
  }
  if (error instanceof ScraperError) {
    return { statusCode: 502, code: error.code, message: error.message, context: error.context };
  }
  if (error instanceof UlysseError) {
    return { statusCode: 500, code: error.code, message: error.message, context: error.context };
  }

  // Unknown error
  return {
    statusCode: 500,
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : 'An unknown error occurred'
  };
}
