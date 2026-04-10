type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  data?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatEntry(entry: LogEntry): string {
  const { timestamp, level, service, message, data } = entry;
  const dataStr = data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : "";
  return `${timestamp} [${level.toUpperCase()}] [${service}] ${message}${dataStr}`;
}

class Logger {
  private service: string;
  private context: Record<string, unknown> = {};

  constructor(service: string) { this.service = service; }

  setContext(ctx: Record<string, unknown>): void {
    this.context = { ...this.context, ...ctx };
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(), level, service: this.service, message,
      data: data ? { ...this.context, ...data } : Object.keys(this.context).length ? this.context : undefined,
    };
    const formatted = formatEntry(entry);
    switch (level) {
      case "error": console.error(formatted); break;
      case "warn": console.warn(formatted); break;
      case "debug": console.debug(formatted); break;
      default: console.log(formatted);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void { this.log("debug", message, data); }
  info(message: string, data?: Record<string, unknown>): void { this.log("info", message, data); }
  warn(message: string, data?: Record<string, unknown>): void { this.log("warn", message, data); }
  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    const errorData = error instanceof Error
      ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
      : error ? { error: String(error) } : {};
    this.log("error", message, { ...data, ...errorData });
  }

  child(service: string): Logger {
    const childLogger = new Logger(`${this.service}:${service}`);
    childLogger.setContext(this.context);
    return childLogger;
  }

  time<T>(label: string, operation: () => T): T {
    const start = Date.now();
    try {
      const result = operation();
      if (result instanceof Promise) {
        return result.then((res) => {
          this.info(`${label} completed`, { duration: Date.now() - start });
          return res;
        }).catch((err) => {
          this.error(`${label} failed`, err, { duration: Date.now() - start });
          throw err;
        }) as T;
      }
      this.info(`${label} completed`, { duration: Date.now() - start });
      return result;
    } catch (err) {
      this.error(`${label} failed`, err, { duration: Date.now() - start });
      throw err;
    }
  }
}

export function createLogger(service: string): Logger {
  return new Logger(service);
}

export const logger = {
  devmax: createLogger("DevMax"),
  devops: createLogger("DevOps"),
  auth: createLogger("Auth"),
  system: createLogger("System"),
};

const safeCatchLogger = createLogger("SafeCatch");

export function safeCatch(context: string, error: unknown): void {
  if (error instanceof Error) {
    safeCatchLogger.warn(`${context}: ${error.message}`);
  } else if (error !== undefined && error !== null) {
    safeCatchLogger.warn(`${context}: ${String(error)}`);
  }
}

export function safeCatchDebug(context: string, error: unknown): void {
  if (error instanceof Error) {
    safeCatchLogger.debug(`${context}: ${error.message}`);
  } else if (error !== undefined && error !== null) {
    safeCatchLogger.debug(`${context}: ${String(error)}`);
  }
}
