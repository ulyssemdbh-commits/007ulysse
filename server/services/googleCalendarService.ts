import { google } from 'googleapis';
import { globalOptimizerService } from "./globalOptimizerService";
import { connectorBridge } from './connectorBridge';

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  isAllDay: boolean;
}

let cachedToken: string | null = null;
let isConnectedCache: boolean | null = null;
let lastConnectionCheck: number = 0;
let lastTokenFetch = 0;
const CACHE_TTL = 60000;

let circuitBreakerOpen = false;
let circuitBreakerUntil = 0;
const CIRCUIT_BREAKER_DURATION = 60 * 60 * 1000;

function isCircuitBreakerOpen(): boolean {
  if (!circuitBreakerOpen) return false;
  if (Date.now() > circuitBreakerUntil) {
    circuitBreakerOpen = false;
    console.log('[Calendar] Circuit breaker reset — will retry on next call');
    return false;
  }
  return true;
}

function tripCircuitBreaker(reason: string): void {
  circuitBreakerOpen = true;
  circuitBreakerUntil = Date.now() + CIRCUIT_BREAKER_DURATION;
  isConnectedCache = false;
  lastConnectionCheck = Date.now();
  console.warn(`[Calendar] Circuit breaker OPEN for 1h — reason: ${reason}`);
}

async function getAccessToken(): Promise<string> {
  if (isCircuitBreakerOpen()) {
    throw new Error('Google Calendar circuit breaker open (token invalid). Will retry later.');
  }

  const now = Date.now();
  if (cachedToken && now - lastTokenFetch < 300000) return cachedToken;

  const conn = await connectorBridge.getGoogleCalendar();
  if (conn.source === 'none' || !conn.accessToken) {
    tripCircuitBreaker('not configured');
    throw new Error('Google Calendar not configured. Set GOOGLE_ACCESS_TOKEN.');
  }

  if (conn.refreshToken && conn.clientId && conn.clientSecret) {
    try {
      const oauth2 = new google.auth.OAuth2(conn.clientId, conn.clientSecret);
      oauth2.setCredentials({ refresh_token: conn.refreshToken });
      const { credentials } = await oauth2.refreshAccessToken();
      cachedToken = credentials.access_token || conn.accessToken;
    } catch {
      cachedToken = conn.accessToken;
    }
  } else {
    cachedToken = conn.accessToken;
  }

  lastTokenFetch = now;
  console.log('[Calendar] Got access token via direct API key');
  return cachedToken!;
}

async function getCalendarClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export const calendarService = {
  async isConnected(userId?: number): Promise<boolean> {
    if (isCircuitBreakerOpen()) return false;

    const now = Date.now();
    if (isConnectedCache !== null && (now - lastConnectionCheck) < CACHE_TTL) {
      return isConnectedCache;
    }

    try {
      await getAccessToken();
      isConnectedCache = true;
      lastConnectionCheck = now;
      console.log('[Calendar] Connection check: SUCCESS');
      return true;
    } catch (err) {
      console.log('[Calendar] Connection check: FAILED -', (err as Error).message);
      isConnectedCache = false;
      lastConnectionCheck = now;
      return false;
    }
  },

  async getTodayEvents(userId: number): Promise<CalendarEvent[]> {
    const dateKey = new Date().toISOString().split('T')[0];
    return globalOptimizerService.getOrFetch(
      `today:${userId}:${dateKey}`,
      "calendar_day",
      async () => {
        try {
          const calendar = await getCalendarClient();
          
          const now = new Date();
          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

          console.log('[Calendar] Fetching events from', startOfDay.toISOString(), 'to', endOfDay.toISOString());

          const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startOfDay.toISOString(),
            timeMax: endOfDay.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 20,
          });

          const events = response.data.items || [];
          console.log('[Calendar] Found', events.length, 'events today');
          
          return events.map((event: any) => ({
            id: event.id || '',
            summary: event.summary || 'Sans titre',
            description: event.description || undefined,
            start: event.start?.dateTime || event.start?.date || '',
            end: event.end?.dateTime || event.end?.date || '',
            location: event.location || undefined,
            isAllDay: !event.start?.dateTime,
          }));
        } catch (err: any) {
          if (err?.response?.status === 401 || err?.code === 401 || err?.status === 401 || (err?.message && err.message.includes('invalid_token'))) {
            tripCircuitBreaker('401 Unauthorized / invalid_token');
          } else {
            console.error('[Calendar] getTodayEvents error:', err?.message || err);
          }
          return [];
        }
      }
    );
  },

  async getUpcomingEvents(userId: number, days: number = 7): Promise<CalendarEvent[]> {
    try {
      const calendar = await getCalendarClient();
      
      const now = new Date();
      const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });

      const events = response.data.items || [];
      
      return events.map((event: any) => ({
        id: event.id || '',
        summary: event.summary || 'Sans titre',
        description: event.description || undefined,
        start: event.start?.dateTime || event.start?.date || '',
        end: event.end?.dateTime || event.end?.date || '',
        location: event.location || undefined,
        isAllDay: !event.start?.dateTime,
      }));
    } catch (err: any) {
      if (err?.response?.status === 401 || err?.code === 401 || err?.status === 401 || (err?.message && err.message.includes('invalid_token'))) {
        tripCircuitBreaker('401 Unauthorized / invalid_token');
      } else {
        console.error('[Calendar] getUpcomingEvents error:', err?.message || err);
      }
      return [];
    }
  },

  async createEvent(
    userId: number,
    summary: string,
    startTime: Date,
    endTime: Date,
    options?: { description?: string; location?: string }
  ): Promise<CalendarEvent | null> {
    try {
      const calendar = await getCalendarClient();

      const event = {
        summary,
        description: options?.description,
        location: options?.location,
        start: { dateTime: startTime.toISOString(), timeZone: 'Europe/Paris' },
        end: { dateTime: endTime.toISOString(), timeZone: 'Europe/Paris' },
      };

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });
      
      // Invalidate calendar cache after creating event
      globalOptimizerService.invalidate("calendar_day");
      globalOptimizerService.invalidate("calendar_events");

      console.log('[Calendar] Created event:', response.data.id);

      return {
        id: response.data.id || '',
        summary: response.data.summary || summary,
        description: response.data.description || undefined,
        start: response.data.start?.dateTime || response.data.start?.date || '',
        end: response.data.end?.dateTime || response.data.end?.date || '',
        location: response.data.location || undefined,
        isAllDay: false,
      };
    } catch (err) {
      console.error('[Calendar] createEvent error:', err);
      return null;
    }
  },
  
  formatEventsForAI(events: CalendarEvent[]): string {
    if (!events || events.length === 0) {
      return "Aucun événement prévu.";
    }
    
    return events.map(event => {
      const startDate = new Date(event.start);
      const endDate = new Date(event.end);
      
      let timeStr = "";
      if (event.isAllDay) {
        timeStr = "Toute la journée";
      } else {
        const startTime = startDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const endTime = endDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        timeStr = `${startTime} - ${endTime}`;
      }
      
      let eventLine = `• ${timeStr}: ${event.summary}`;
      if (event.location) {
        eventLine += ` (📍 ${event.location})`;
      }
      if (event.description) {
        eventLine += ` - ${event.description.substring(0, 100)}${event.description.length > 100 ? '...' : ''}`;
      }
      return eventLine;
    }).join('\n');
  },

  clearCache() {
    connectionSettings = null;
    isConnectedCache = null;
    lastConnectionCheck = 0;
    console.log('[Calendar] Cache cleared');
  }
};
