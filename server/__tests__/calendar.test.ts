import { describe, it, expect, vi, beforeEach } from "vitest";

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  attendees?: string[];
  isAllDay?: boolean;
}

function formatEventTime(date: Date, isAllDay: boolean): string {
  if (isAllDay) {
    return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }
  return date.toLocaleString("fr-FR", { 
    weekday: "short", 
    day: "numeric", 
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getEventDuration(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h${mins}`;
}

function isEventToday(event: CalendarEvent): boolean {
  const today = new Date();
  const eventDate = new Date(event.start);
  return (
    eventDate.getFullYear() === today.getFullYear() &&
    eventDate.getMonth() === today.getMonth() &&
    eventDate.getDate() === today.getDate()
  );
}

function isEventUpcoming(event: CalendarEvent, withinMinutes: number = 30): boolean {
  const now = Date.now();
  const eventStart = event.start.getTime();
  const diff = eventStart - now;
  return diff > 0 && diff <= withinMinutes * 60 * 1000;
}

function sortEventsByStart(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
}

describe("Calendar Service", () => {
  describe("Event Time Formatting", () => {
    it("formats all-day events correctly", () => {
      const date = new Date("2026-01-15");
      const formatted = formatEventTime(date, true);
      expect(formatted).toContain("janvier");
    });

    it("formats timed events correctly", () => {
      const date = new Date("2026-01-15T14:30:00");
      const formatted = formatEventTime(date, false);
      expect(formatted).toContain("14");
      expect(formatted).toContain("30");
    });
  });

  describe("Event Duration", () => {
    it("calculates duration in minutes", () => {
      const start = new Date("2026-01-15T10:00:00");
      const end = new Date("2026-01-15T11:30:00");
      expect(getEventDuration(start, end)).toBe(90);
    });

    it("handles multi-hour events", () => {
      const start = new Date("2026-01-15T09:00:00");
      const end = new Date("2026-01-15T17:00:00");
      expect(getEventDuration(start, end)).toBe(480);
    });
  });

  describe("Duration Formatting", () => {
    it("formats minutes only", () => {
      expect(formatDuration(30)).toBe("30 min");
      expect(formatDuration(45)).toBe("45 min");
    });

    it("formats hours only", () => {
      expect(formatDuration(60)).toBe("1h");
      expect(formatDuration(120)).toBe("2h");
    });

    it("formats hours and minutes", () => {
      expect(formatDuration(90)).toBe("1h30");
      expect(formatDuration(150)).toBe("2h30");
    });
  });

  describe("Event Timing Checks", () => {
    it("detects events today", () => {
      const today = new Date();
      const event: CalendarEvent = {
        id: "1",
        summary: "Meeting",
        start: today,
        end: new Date(today.getTime() + 3600000),
      };
      expect(isEventToday(event)).toBe(true);
    });

    it("detects events not today", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const event: CalendarEvent = {
        id: "1",
        summary: "Meeting",
        start: tomorrow,
        end: new Date(tomorrow.getTime() + 3600000),
      };
      expect(isEventToday(event)).toBe(false);
    });

    it("detects upcoming events", () => {
      const soon = new Date(Date.now() + 15 * 60 * 1000);
      const event: CalendarEvent = {
        id: "1",
        summary: "Meeting",
        start: soon,
        end: new Date(soon.getTime() + 3600000),
      };
      expect(isEventUpcoming(event, 30)).toBe(true);
    });
  });

  describe("Event Sorting", () => {
    it("sorts events by start time", () => {
      const events: CalendarEvent[] = [
        { id: "2", summary: "Later", start: new Date("2026-01-15T14:00:00"), end: new Date("2026-01-15T15:00:00") },
        { id: "1", summary: "Earlier", start: new Date("2026-01-15T10:00:00"), end: new Date("2026-01-15T11:00:00") },
      ];
      const sorted = sortEventsByStart(events);
      expect(sorted[0].id).toBe("1");
      expect(sorted[1].id).toBe("2");
    });
  });
});
