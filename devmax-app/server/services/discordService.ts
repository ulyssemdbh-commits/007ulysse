/**
 * Discord Notification Service — Stub for standalone DevMax.
 * Replace with actual Discord webhook/bot implementation if needed.
 */
export const discordService = {
  async sendMessage(content: string, _channel?: string): Promise<void> {
    console.log(`[Discord] Notification (not sent): ${content.slice(0, 100)}...`);
  },
};
