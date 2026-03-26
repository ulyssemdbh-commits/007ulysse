import { describe, it, expect, vi, beforeEach } from "vitest";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class TestLogger {
  private service: string;
  private logs: Array<{ level: LogLevel; message: string; data?: Record<string, unknown> }> = [];
  private currentLevel: LogLevel = "info";

  constructor(service: string) {
    this.service = service;
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.currentLevel];
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    this.logs.push({ level, message, data });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    const errorData = error ? { errorMessage: error.message } : undefined;
    this.log("error", message, { ...data, ...errorData });
  }

  child(childService: string): TestLogger {
    return new TestLogger(`${this.service}:${childService}`);
  }

  getLogs(): typeof this.logs {
    return [...this.logs];
  }

  getService(): string {
    return this.service;
  }

  clear(): void {
    this.logs = [];
  }
}

describe("Logger Service", () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger("TestService");
  });

  describe("Basic Logging", () => {
    it("logs info messages", () => {
      logger.info("Test message");
      const logs = logger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("info");
      expect(logs[0].message).toBe("Test message");
    });

    it("logs warn messages", () => {
      logger.warn("Warning message");
      const logs = logger.getLogs();
      expect(logs[0].level).toBe("warn");
    });

    it("logs error messages with error details", () => {
      const error = new Error("Something failed");
      logger.error("Error occurred", error);
      const logs = logger.getLogs();
      expect(logs[0].level).toBe("error");
      expect(logs[0].data?.errorMessage).toBe("Something failed");
    });

    it("includes data in log entries", () => {
      logger.info("Operation completed", { duration: 100, count: 5 });
      const logs = logger.getLogs();
      expect(logs[0].data).toEqual({ duration: 100, count: 5 });
    });
  });

  describe("Log Levels", () => {
    it("filters debug when level is info", () => {
      logger.setLevel("info");
      logger.debug("Debug message");
      logger.info("Info message");
      expect(logger.getLogs()).toHaveLength(1);
      expect(logger.getLogs()[0].level).toBe("info");
    });

    it("shows all logs when level is debug", () => {
      logger.setLevel("debug");
      logger.debug("Debug message");
      logger.info("Info message");
      expect(logger.getLogs()).toHaveLength(2);
    });

    it("only shows errors when level is error", () => {
      logger.setLevel("error");
      logger.debug("Debug");
      logger.info("Info");
      logger.warn("Warn");
      logger.error("Error", new Error("test"));
      expect(logger.getLogs()).toHaveLength(1);
      expect(logger.getLogs()[0].level).toBe("error");
    });
  });

  describe("Child Loggers", () => {
    it("creates child logger with prefixed service name", () => {
      const child = logger.child("SubModule");
      expect(child.getService()).toBe("TestService:SubModule");
    });

    it("child logger logs independently", () => {
      const child = logger.child("SubModule");
      logger.info("Parent log");
      child.info("Child log");
      expect(logger.getLogs()).toHaveLength(1);
      expect(child.getLogs()).toHaveLength(1);
    });
  });

  describe("Clear Logs", () => {
    it("clears all logs", () => {
      logger.info("Log 1");
      logger.info("Log 2");
      logger.clear();
      expect(logger.getLogs()).toHaveLength(0);
    });
  });
});
