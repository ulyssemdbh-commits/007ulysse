export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error) => boolean;
  onRetry?: (error: Error, attempt: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  shouldRetry: () => true
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error("Unknown error");
  
  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      const isLastAttempt = attempt === opts.maxRetries - 1;
      const shouldRetryError = opts.shouldRetry ? opts.shouldRetry(error) : true;
      
      if (isLastAttempt || !shouldRetryError) {
        throw error;
      }
      
      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt),
        opts.maxDelayMs || 30000
      );
      
      console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${error.message}`);
      
      if (opts.onRetry) {
        opts.onRetry(error, attempt + 1);
      }
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("network") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("429")
  );
}

export function shouldNotRetry(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("404") ||
    message.includes("invalid") ||
    message.includes("unauthorized")
  );
}
