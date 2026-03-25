/**
 * Type-safe error message extraction.
 *
 * Usage:
 *   catch (error: unknown) {
 *     console.error(getErrorMessage(error));
 *   }
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return String(error);
}
