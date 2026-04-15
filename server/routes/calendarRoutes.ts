import { Router } from "express";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/today", requireAuth, async (req, res) => {
  try {
    const { calendarService } = await import("../services/googleCalendarService");
    const now = new Date();
    const events = await calendarService.getUpcomingEvents(1, 20);

    const todayEvents = events
      .filter((e: any) => {
        const start = e.start?.dateTime || e.start?.date;
        if (!start) return false;
        const d = new Date(start);
        return d.toDateString() === now.toDateString();
      })
      .map((e: any) => ({
        id: e.id,
        summary: e.summary,
        start: e.start,
        end: e.end,
        location: e.location,
      }));

    res.json(todayEvents);
  } catch (err: any) {
    console.error("[Calendar] Error fetching today events:", err.message);
    res.json([]);
  }
});

export default router;
