import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface Job {
  id: string;
  name: string;
  schedule: string;
  handler: () => Promise<void>;
  lastRun: Date | null;
  nextRun: Date | null;
  isRunning: boolean;
  enabled: boolean;
}

function parseCronSchedule(schedule: string): { minute: number | null; hour: number | null; dayOfMonth: number | null; month: number | null; dayOfWeek: number | null } {
  const parts = schedule.split(" ");
  if (parts.length !== 5) return { minute: null, hour: null, dayOfMonth: null, month: null, dayOfWeek: null };
  
  return {
    minute: parts[0] === "*" ? null : parseInt(parts[0]),
    hour: parts[1] === "*" ? null : parseInt(parts[1]),
    dayOfMonth: parts[2] === "*" ? null : parseInt(parts[2]),
    month: parts[3] === "*" ? null : parseInt(parts[3]),
    dayOfWeek: parts[4] === "*" ? null : parseInt(parts[4]),
  };
}

function calculateNextRun(schedule: string, from: Date = new Date()): Date {
  const parsed = parseCronSchedule(schedule);
  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);
  
  if (parsed.minute !== null) {
    next.setMinutes(parsed.minute);
    if (next <= from) next.setHours(next.getHours() + 1);
  } else {
    next.setMinutes(next.getMinutes() + 1);
  }
  
  if (parsed.hour !== null) {
    next.setHours(parsed.hour);
    if (next <= from) next.setDate(next.getDate() + 1);
  }
  
  return next;
}

function shouldRunNow(job: Job, now: Date = new Date()): boolean {
  if (!job.enabled || job.isRunning) return false;
  if (!job.nextRun) return true;
  return now >= job.nextRun;
}

function formatNextRun(nextRun: Date | null): string {
  if (!nextRun) return "Not scheduled";
  
  const now = new Date();
  const diff = nextRun.getTime() - now.getTime();
  
  if (diff < 0) return "Overdue";
  if (diff < 60000) return "Less than a minute";
  if (diff < 3600000) return `${Math.round(diff / 60000)} minutes`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} hours`;
  return `${Math.round(diff / 86400000)} days`;
}

describe("Job Scheduler", () => {
  describe("Cron Parsing", () => {
    it("parses standard cron schedule", () => {
      const result = parseCronSchedule("30 9 * * *");
      expect(result.minute).toBe(30);
      expect(result.hour).toBe(9);
      expect(result.dayOfMonth).toBeNull();
    });

    it("parses all wildcards", () => {
      const result = parseCronSchedule("* * * * *");
      expect(result.minute).toBeNull();
      expect(result.hour).toBeNull();
    });

    it("handles invalid format", () => {
      const result = parseCronSchedule("invalid");
      expect(result.minute).toBeNull();
    });
  });

  describe("Next Run Calculation", () => {
    it("calculates next run for hourly job", () => {
      const from = new Date("2026-01-15T10:30:00");
      const next = calculateNextRun("0 * * * *", from);
      expect(next.getMinutes()).toBe(0);
      expect(next.getHours()).toBe(11);
    });

    it("calculates next run for daily job", () => {
      const from = new Date("2026-01-15T10:30:00");
      const next = calculateNextRun("0 9 * * *", from);
      expect(next.getHours()).toBe(9);
      expect(next.getDate()).toBe(16);
    });
  });

  describe("Should Run Check", () => {
    it("returns true when job is due", () => {
      const job: Job = {
        id: "1", name: "Test", schedule: "* * * * *",
        handler: async () => {}, lastRun: null,
        nextRun: new Date(Date.now() - 60000),
        isRunning: false, enabled: true
      };
      expect(shouldRunNow(job)).toBe(true);
    });

    it("returns false when job is running", () => {
      const job: Job = {
        id: "1", name: "Test", schedule: "* * * * *",
        handler: async () => {}, lastRun: null,
        nextRun: new Date(Date.now() - 60000),
        isRunning: true, enabled: true
      };
      expect(shouldRunNow(job)).toBe(false);
    });

    it("returns false when job is disabled", () => {
      const job: Job = {
        id: "1", name: "Test", schedule: "* * * * *",
        handler: async () => {}, lastRun: null,
        nextRun: new Date(Date.now() - 60000),
        isRunning: false, enabled: false
      };
      expect(shouldRunNow(job)).toBe(false);
    });
  });

  describe("Next Run Formatting", () => {
    it("formats minutes", () => {
      const nextRun = new Date(Date.now() + 5 * 60000);
      const formatted = formatNextRun(nextRun);
      expect(formatted).toContain("minutes");
    });

    it("formats hours", () => {
      const nextRun = new Date(Date.now() + 3 * 3600000);
      const formatted = formatNextRun(nextRun);
      expect(formatted).toContain("hours");
    });

    it("handles null", () => {
      expect(formatNextRun(null)).toBe("Not scheduled");
    });

    it("handles overdue", () => {
      const nextRun = new Date(Date.now() - 60000);
      expect(formatNextRun(nextRun)).toBe("Overdue");
    });
  });
});
