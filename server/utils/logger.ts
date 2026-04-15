type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatMessage(
  level: LogLevel,
  tag: string,
  message: string,
  data?: Record<string, unknown>
): string {
  if (IS_PRODUCTION) {
    return JSON.stringify({
      ts: new Date().toISOString(),
      level,
      tag,
      msg: message,
      ...(data || {}),
    });
  }
  const prefix = `[${tag}]`;
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  return `${prefix} ${message}${dataStr}`;
}

function createTagLogger(tag: string) {
  return {
    debug(msg: string, data?: Record<string, unknown>) {
      if (shouldLog("debug")) console.debug(formatMessage("debug", tag, msg, data));
    },
    info(msg: string, data?: Record<string, unknown>) {
      if (shouldLog("info")) console.log(formatMessage("info", tag, msg, data));
    },
    warn(msg: string, data?: Record<string, unknown>) {
      if (shouldLog("warn")) console.warn(formatMessage("warn", tag, msg, data));
    },
    error(msg: string, data?: Record<string, unknown>) {
      if (shouldLog("error")) console.error(formatMessage("error", tag, msg, data));
    },
    fatal(msg: string, data?: Record<string, unknown>) {
      if (shouldLog("fatal")) console.error(formatMessage("fatal", tag, msg, data));
    },
  };
}

export function createLogger(tag: string) {
  return createTagLogger(tag);
}

export const log = createTagLogger("App");
