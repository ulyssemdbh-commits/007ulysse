/**
 * Google Calendar Service — Stub for standalone SUGUVal.
 * Replace with googleapis integration if needed.
 */
export const calendarService = {
  async addEvent(opts: { summary: string; date: string; description?: string }): Promise<{ success: boolean }> {
    console.log(`[Calendar] Would add event: ${opts.summary} on ${opts.date}`);
    return { success: true };
  },

  async listEvents(dateFrom: string, dateTo: string): Promise<unknown[]> {
    console.log(`[Calendar] Would list events from ${dateFrom} to ${dateTo}`);
    return [];
  },
};
