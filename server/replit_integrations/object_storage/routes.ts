import type { Express } from "express";

/**
 * Register object storage routes.
 * 
 * NOTE: For Ulysse, file uploads and downloads are handled through 
 * dedicated authenticated routes in server/routes.ts, not through
 * these generic routes. This function is kept minimal for security.
 */
export function registerObjectStorageRoutes(app: Express): void {
  // No public routes registered - all file access is handled 
  // through authenticated Ulysse-specific routes in routes.ts
}
