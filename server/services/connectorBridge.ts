export type ConnectorSource = 'direct' | 'replit-connector' | 'none';

export interface ConnectorResult {
  source: ConnectorSource;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
}

async function fetchReplitConnectorToken(connectorName: string): Promise<ConnectorResult> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!hostname || !xReplitToken) {
    return { source: 'none' };
  }

  try {
    const resp = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=${connectorName}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Replit-Token': xReplitToken,
        },
      }
    );
    const data = await resp.json();
    const conn = data.items?.[0];
    if (!conn) return { source: 'none' };

    const accessToken = conn.settings?.access_token
      || conn.settings?.oauth?.credentials?.access_token;

    if (!accessToken) return { source: 'none' };

    return {
      source: 'replit-connector',
      accessToken,
      refreshToken: conn.settings?.refresh_token,
    };
  } catch (err) {
    console.error(`[ConnectorBridge] Replit connector fetch failed for ${connectorName}:`, err);
    return { source: 'none' };
  }
}

export const connectorBridge = {

  async getGoogleMail(): Promise<ConnectorResult> {
    const token = process.env.GOOGLE_ACCESS_TOKEN || process.env.GOOGLE_MAIL_ACCESS_TOKEN;
    if (token) return { source: 'direct', accessToken: token, refreshToken: process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_MAIL_REFRESH_TOKEN, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
    return fetchReplitConnectorToken('google-mail');
  },

  async getGoogleCalendar(): Promise<ConnectorResult> {
    const token = process.env.GOOGLE_ACCESS_TOKEN || process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
    if (token) return { source: 'direct', accessToken: token, refreshToken: process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
    return fetchReplitConnectorToken('google-calendar');
  },

  async getGoogleDrive(): Promise<ConnectorResult> {
    const token = process.env.GOOGLE_ACCESS_TOKEN || process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
    if (token) return { source: 'direct', accessToken: token, refreshToken: process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_DRIVE_REFRESH_TOKEN, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
    return fetchReplitConnectorToken('google-drive');
  },

  async getSpotify(): Promise<ConnectorResult> {
    if (process.env.SPOTIFY_ACCESS_TOKEN) return { source: 'direct', accessToken: process.env.SPOTIFY_ACCESS_TOKEN, refreshToken: process.env.SPOTIFY_REFRESH_TOKEN, clientId: process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET };
    return fetchReplitConnectorToken('spotify');
  },

  async getNotion(): Promise<ConnectorResult> {
    const key = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
    if (key) return { source: 'direct', apiKey: key };
    return fetchReplitConnectorToken('notion');
  },

  async getTodoist(): Promise<ConnectorResult> {
    const key = process.env.TODOIST_API_KEY || process.env.TODOIST_TOKEN;
    if (key) return { source: 'direct', apiKey: key };
    return { source: 'none' };
  },

  async getAgentMail(): Promise<ConnectorResult> {
    if (process.env.AGENTMAIL_API_KEY) return { source: 'direct', apiKey: process.env.AGENTMAIL_API_KEY };
    return fetchReplitConnectorToken('agentmail');
  },

  async getGitHub(): Promise<ConnectorResult> {
    const pat = process.env.MAURICE_GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (pat) return { source: 'direct', accessToken: pat };
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
    if (token) return { source: 'direct', accessToken: token };
    const connectorResult = await fetchReplitConnectorToken('github');
    if (connectorResult.source !== 'none' && connectorResult.accessToken) {
      return connectorResult;
    }
    return { source: 'none' };
  },

  async getOpenAI(): Promise<ConnectorResult> {
    const key = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (key) return { source: 'direct', apiKey: key };
    return { source: 'none' };
  },

  async getGemini(): Promise<ConnectorResult> {
    const key = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    if (key) return { source: 'direct', apiKey: key };
    return { source: 'none' };
  },

  async getDiscord(): Promise<ConnectorResult> {
    if (process.env.DISCORD_BOT_TOKEN) return { source: 'direct', accessToken: process.env.DISCORD_BOT_TOKEN };
    return { source: 'none' };
  },

  async getPerplexity(): Promise<ConnectorResult> {
    const key = process.env.PERPLEXITY_API_KEY || process.env.AI_INTEGRATIONS_PERPLEXITY_API_KEY;
    if (key) return { source: 'direct', apiKey: key };
    return { source: 'none' };
  },

  async diagnose(): Promise<Record<string, { available: boolean; source: ConnectorSource }>> {
    const results: Record<string, { available: boolean; source: ConnectorSource }> = {};
    const checks: [string, () => Promise<ConnectorResult>][] = [
      ['google-mail', () => this.getGoogleMail()],
      ['google-calendar', () => this.getGoogleCalendar()],
      ['google-drive', () => this.getGoogleDrive()],
      ['spotify', () => this.getSpotify()],
      ['notion', () => this.getNotion()],
      ['todoist', () => this.getTodoist()],
      ['agentmail', () => this.getAgentMail()],
      ['github', () => this.getGitHub()],
      ['openai', () => this.getOpenAI()],
      ['gemini', () => this.getGemini()],
      ['discord', () => this.getDiscord()],
      ['perplexity', () => this.getPerplexity()],
    ];
    for (const [name, fn] of checks) {
      try {
        const r = await fn();
        results[name] = { available: r.source !== 'none', source: r.source };
      } catch {
        results[name] = { available: false, source: 'none' };
      }
    }
    console.log(`[ConnectorBridge] Status:`, Object.entries(results).map(([k, v]) => `${k}=${v.available ? v.source : 'MISSING'}`).join(', '));
    return results;
  }
};
