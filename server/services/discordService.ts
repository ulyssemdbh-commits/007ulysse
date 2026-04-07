// Discord Service using Webhooks for DevFlow/Ulysse notifications

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
  thumbnail?: { url: string };
}

export interface WebhookPayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

class DiscordService {
  private webhookUrl: string | null = null;

  constructor() {
    this.webhookUrl = process.env.DISCORD_WEBHOOK_URL || null;
    if (this.webhookUrl) {
      console.log('[Discord] Webhook configured');
    } else {
      console.log('[Discord] No webhook URL configured');
    }
  }

  async checkConnection(): Promise<boolean> {
    if (!this.webhookUrl) {
      console.log('[Discord] Connection check: FAILED - No webhook URL');
      return false;
    }
    
    try {
      const response = await fetch(this.webhookUrl, { method: 'GET' });
      const connected = response.ok;
      console.log(`[Discord] Connection check: ${connected ? 'SUCCESS' : 'FAILED'}`);
      return connected;
    } catch (error: any) {
      console.log('[Discord] Connection check: FAILED -', error.message);
      return false;
    }
  }

  async sendWebhook(payload: WebhookPayload): Promise<boolean> {
    if (!this.webhookUrl) {
      console.error('[Discord] No webhook URL configured');
      return false;
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: payload.username || 'Ulysse AI',
          avatar_url: payload.avatar_url || 'https://i.imgur.com/AfFp7pu.png',
          ...payload
        })
      });

      if (response.ok || response.status === 204) {
        console.log('[Discord] Webhook sent successfully');
        return true;
      } else {
        const error = await response.text();
        console.error('[Discord] Webhook failed:', response.status, error);
        return false;
      }
    } catch (error: any) {
      console.error('[Discord] Webhook error:', error.message);
      return false;
    }
  }

  async sendMessage(message: string): Promise<boolean> {
    return this.sendWebhook({ content: message });
  }

  async sendNotification(params: {
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error' | 'sport';
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }): Promise<boolean> {
    const colorMap = {
      info: 0x3498db,
      success: 0x2ecc71,
      warning: 0xf39c12,
      error: 0xe74c3c,
      sport: 0x9b59b6
    };

    const embed: DiscordEmbed = {
      title: params.title,
      description: params.message,
      color: colorMap[params.type || 'info'],
      fields: params.fields || [],
      footer: { text: 'DevFlow • Ulysse AI' },
      timestamp: new Date().toISOString()
    };

    return this.sendWebhook({ embeds: [embed] });
  }

  async sendMatchAlert(params: {
    homeTeam: string;
    awayTeam: string;
    league: string;
    time: string;
    odds?: { home: number; draw: number; away: number };
    prediction?: string;
  }): Promise<boolean> {
    const fields = [
      { name: '🏆 Ligue', value: params.league, inline: true },
      { name: '⏰ Horaire', value: params.time, inline: true }
    ];

    if (params.odds) {
      fields.push({
        name: '📊 Cotes',
        value: `1: ${params.odds.home} | N: ${params.odds.draw} | 2: ${params.odds.away}`,
        inline: false
      });
    }

    if (params.prediction) {
      fields.push({ name: '🎯 Prono Ulysse', value: params.prediction, inline: false });
    }

    return this.sendNotification({
      title: `⚽ ${params.homeTeam} vs ${params.awayTeam}`,
      message: 'Match à surveiller !',
      type: 'sport',
      fields
    });
  }

  async sendHomeworkResult(params: {
    homeworkName: string;
    status: 'success' | 'error';
    summary: string;
    details?: string;
  }): Promise<boolean> {
    const fields = [
      { name: '📋 Résumé', value: params.summary, inline: false }
    ];

    if (params.details) {
      fields.push({ name: '📝 Détails', value: params.details.substring(0, 1000), inline: false });
    }

    return this.sendNotification({
      title: `📚 Homework: ${params.homeworkName}`,
      message: params.status === 'success' ? '✅ Exécution réussie' : '❌ Échec de l\'exécution',
      type: params.status === 'success' ? 'success' : 'error',
      fields
    });
  }

  async sendDailyBrief(params: {
    weather?: string;
    tasks?: string[];
    events?: string[];
    matches?: string[];
  }): Promise<boolean> {
    const fields: Array<{ name: string; value: string; inline: boolean }> = [];

    if (params.weather) {
      fields.push({ name: '🌤️ Météo', value: params.weather, inline: false });
    }

    if (params.tasks && params.tasks.length > 0) {
      fields.push({ name: '✅ Tâches du jour', value: params.tasks.slice(0, 5).join('\n'), inline: false });
    }

    if (params.events && params.events.length > 0) {
      fields.push({ name: '📅 Événements', value: params.events.slice(0, 5).join('\n'), inline: false });
    }

    if (params.matches && params.matches.length > 0) {
      fields.push({ name: '⚽ Matchs du jour', value: params.matches.slice(0, 5).join('\n'), inline: false });
    }

    return this.sendNotification({
      title: '☀️ Brief du matin',
      message: `Bonjour Maurice ! Voici ton résumé pour le ${new Date().toLocaleDateString('fr-FR')}`,
      type: 'info',
      fields
    });
  }
}

export const discordService = new DiscordService();

export const DISCORD_ULYSSE_TOOLS = {
  name: 'discord',
  description: 'Send messages and notifications to Discord via webhook',
  functions: {
    sendMessage: {
      description: 'Send a simple text message to Discord',
      parameters: {
        message: { type: 'string', description: 'Message content' }
      },
      handler: async (params: { message: string }) => {
        const success = await discordService.sendMessage(params.message);
        return { success, message: success ? 'Message sent' : 'Failed to send message' };
      }
    },
    sendNotification: {
      description: 'Send a formatted notification embed to Discord',
      parameters: {
        title: { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification message' },
        type: { type: 'string', description: 'Type: info, success, warning, error, sport' }
      },
      handler: async (params: { title: string; message: string; type?: string }) => {
        const success = await discordService.sendNotification({
          title: params.title,
          message: params.message,
          type: params.type as any || 'info'
        });
        return { success };
      }
    },
    sendMatchAlert: {
      description: 'Send a football match alert with optional odds and prediction',
      parameters: {
        homeTeam: { type: 'string', description: 'Home team name' },
        awayTeam: { type: 'string', description: 'Away team name' },
        league: { type: 'string', description: 'League name' },
        time: { type: 'string', description: 'Match time' },
        prediction: { type: 'string', description: 'Ulysse prediction (optional)' }
      },
      handler: async (params: any) => {
        const success = await discordService.sendMatchAlert(params);
        return { success };
      }
    },
    checkConnection: {
      description: 'Check if Discord webhook is configured and working',
      parameters: {},
      handler: async () => {
        const connected = await discordService.checkConnection();
        return { connected };
      }
    }
  }
};
