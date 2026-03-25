import { describe, it, expect, vi, beforeEach } from "vitest";

interface Homework {
  id: number;
  userId: number;
  title: string;
  description: string;
  schedule: string;
  frequency: "hourly" | "daily" | "weekly";
  isActive: boolean;
  lastExecuted: Date | null;
  nextExecution: Date | null;
  createdAt: Date;
}

function parseSchedule(schedule: string): { hour?: number; minute?: number; dayOfWeek?: number } {
  const parts = schedule.split(" ");
  if (parts.length < 2) return {};
  
  const minute = parts[0] === "*" ? undefined : parseInt(parts[0]);
  const hour = parts[1] === "*" ? undefined : parseInt(parts[1]);
  const dayOfWeek = parts.length > 4 && parts[4] !== "*" ? parseInt(parts[4]) : undefined;
  
  return { hour, minute, dayOfWeek };
}

function isDue(homework: Homework, now: Date = new Date()): boolean {
  if (!homework.isActive) return false;
  if (!homework.nextExecution) return true;
  return now >= homework.nextExecution;
}

function calculateNextExecution(homework: Homework, from: Date = new Date()): Date {
  const next = new Date(from);
  
  switch (homework.frequency) {
    case "hourly":
      next.setHours(next.getHours() + 1);
      next.setMinutes(0);
      next.setSeconds(0);
      break;
    case "daily":
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      next.setHours(9, 0, 0, 0);
      break;
  }
  
  return next;
}

function filterDueHomework(homeworks: Homework[], now: Date = new Date()): Homework[] {
  return homeworks.filter(hw => isDue(hw, now));
}

function sortByPriority(homeworks: Homework[]): Homework[] {
  return [...homeworks].sort((a, b) => {
    if (!a.nextExecution && !b.nextExecution) return 0;
    if (!a.nextExecution) return -1;
    if (!b.nextExecution) return 1;
    return a.nextExecution.getTime() - b.nextExecution.getTime();
  });
}

describe("Homework Service", () => {
  describe("Schedule Parsing", () => {
    it("parses cron-like schedule", () => {
      const result = parseSchedule("30 9 * * *");
      expect(result.minute).toBe(30);
      expect(result.hour).toBe(9);
    });

    it("parses weekly schedule", () => {
      const result = parseSchedule("0 10 * * 1");
      expect(result.minute).toBe(0);
      expect(result.hour).toBe(10);
      expect(result.dayOfWeek).toBe(1);
    });

    it("handles wildcards", () => {
      const result = parseSchedule("* * * * *");
      expect(result.minute).toBeUndefined();
      expect(result.hour).toBeUndefined();
    });
  });

  describe("Due Check", () => {
    it("returns true for active homework with past execution time", () => {
      const homework: Homework = {
        id: 1, userId: 1, title: "Test", description: "",
        schedule: "0 9 * * *", frequency: "daily", isActive: true,
        lastExecuted: null,
        nextExecution: new Date(Date.now() - 3600000),
        createdAt: new Date()
      };
      expect(isDue(homework)).toBe(true);
    });

    it("returns false for inactive homework", () => {
      const homework: Homework = {
        id: 1, userId: 1, title: "Test", description: "",
        schedule: "0 9 * * *", frequency: "daily", isActive: false,
        lastExecuted: null, nextExecution: null, createdAt: new Date()
      };
      expect(isDue(homework)).toBe(false);
    });

    it("returns true for homework with no next execution", () => {
      const homework: Homework = {
        id: 1, userId: 1, title: "Test", description: "",
        schedule: "0 9 * * *", frequency: "daily", isActive: true,
        lastExecuted: null, nextExecution: null, createdAt: new Date()
      };
      expect(isDue(homework)).toBe(true);
    });
  });

  describe("Next Execution Calculation", () => {
    it("calculates hourly next execution", () => {
      const homework: Homework = {
        id: 1, userId: 1, title: "Test", description: "",
        schedule: "0 * * * *", frequency: "hourly", isActive: true,
        lastExecuted: null, nextExecution: null, createdAt: new Date()
      };
      const now = new Date("2026-01-15T10:30:00");
      const next = calculateNextExecution(homework, now);
      expect(next.getHours()).toBe(11);
      expect(next.getMinutes()).toBe(0);
    });

    it("calculates daily next execution", () => {
      const homework: Homework = {
        id: 1, userId: 1, title: "Test", description: "",
        schedule: "0 9 * * *", frequency: "daily", isActive: true,
        lastExecuted: null, nextExecution: null, createdAt: new Date()
      };
      const now = new Date("2026-01-15T10:30:00");
      const next = calculateNextExecution(homework, now);
      expect(next.getDate()).toBe(16);
      expect(next.getHours()).toBe(9);
    });

    it("calculates weekly next execution", () => {
      const homework: Homework = {
        id: 1, userId: 1, title: "Test", description: "",
        schedule: "0 9 * * 1", frequency: "weekly", isActive: true,
        lastExecuted: null, nextExecution: null, createdAt: new Date()
      };
      const now = new Date("2026-01-15T10:30:00");
      const next = calculateNextExecution(homework, now);
      expect(next.getDate()).toBe(22);
    });
  });

  describe("Filtering and Sorting", () => {
    const homeworks: Homework[] = [
      { id: 1, userId: 1, title: "Due", description: "", schedule: "", frequency: "daily", isActive: true, lastExecuted: null, nextExecution: new Date(Date.now() - 3600000), createdAt: new Date() },
      { id: 2, userId: 1, title: "Not Due", description: "", schedule: "", frequency: "daily", isActive: true, lastExecuted: null, nextExecution: new Date(Date.now() + 3600000), createdAt: new Date() },
      { id: 3, userId: 1, title: "Inactive", description: "", schedule: "", frequency: "daily", isActive: false, lastExecuted: null, nextExecution: null, createdAt: new Date() },
    ];

    it("filters due homework", () => {
      const due = filterDueHomework(homeworks);
      expect(due.length).toBe(1);
      expect(due[0].id).toBe(1);
    });

    it("sorts by next execution", () => {
      const sorted = sortByPriority(homeworks);
      expect(sorted[0].id).toBe(3);
    });
  });
});
