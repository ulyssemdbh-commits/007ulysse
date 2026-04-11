/**
 * Email Service — Stub for myBeez.
 * Replace with your actual email provider (nodemailer, SendGrid, etc.)
 */
export const emailActionService = {
  async sendEmail(opts: { to: string | string[]; subject: string; html: string; from?: string }): Promise<{ success: boolean }> {
    console.log(`[Email] Would send to ${opts.to}: ${opts.subject}`);
    return { success: true };
  },

  async logEmailAction(action: string, details?: Record<string, unknown>): Promise<void> {
    console.log(`[Email] Action logged: ${action}`, details);
  },
};
