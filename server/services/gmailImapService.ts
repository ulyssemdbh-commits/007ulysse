import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

const GMAIL_IMAP_HOST = 'imap.gmail.com';
const GMAIL_USER = 'ulyssemdbh@gmail.com';

function getAppPassword(): string {
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) throw new Error('GMAIL_APP_PASSWORD non configuré. Crée un mot de passe d\'application Google et ajoute-le dans les secrets.');
  return pass;
}

function makeClient() {
  return new ImapFlow({
    host: GMAIL_IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: getAppPassword() },
    logger: false,
  });
}

export const gmailImapService = {
  async isConnected(): Promise<boolean> {
    const client = makeClient();
    try {
      await client.connect();
      await client.logout();
      return true;
    } catch {
      return false;
    }
  },

  async listMessages(params: { maxResults?: number; query?: string; folder?: string } = {}): Promise<{
    position: number;
    uid: number;
    from: string;
    subject: string;
    date: string;
    snippet: string;
    unread: boolean;
    hasAttachments: boolean;
  }[]> {
    const { maxResults = 15, folder = 'INBOX' } = params;
    const client = makeClient();
    await client.connect();
    const results: any[] = [];

    try {
      const lock = await client.getMailboxLock(folder);
      try {
        const status = await client.status(folder, { messages: true, unseen: true });
        const total = status.messages || 0;
        if (total === 0) return [];

        const start = Math.max(1, total - maxResults + 1);
        const range = `${start}:*`;

        for await (const msg of client.fetch(range, {
          uid: true,
          flags: true,
          envelope: true,
          bodyStructure: true,
        })) {
          const env = (msg as any).envelope;
          const flags = (msg as any).flags as Set<string>;
          const bs = (msg as any).bodyStructure;
          const from = env?.from?.[0] ? `${env.from[0].name || ''} <${env.from[0].address}>`.trim() : '';
          const subject = env?.subject || '(Sans objet)';
          const date = env?.date ? new Date(env.date).toLocaleString('fr-FR') : '';
          const unread = !flags.has('\\Seen');

          // Detect attachments from body structure
          const hasAttachments = hasAttachmentInStructure(bs);

          results.push({ uid: (msg as any).uid, from, subject, date, snippet: '', unread, hasAttachments });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }

    // Reverse so newest is first, then add position numbers (1 = most recent)
    const reversed = results.reverse();
    return reversed.map((m, i) => ({ ...m, position: i + 1 }));
  },

  async getMessage(uid: number, folder: string = 'INBOX'): Promise<{
    from: string;
    replyTo: string;
    to: string;
    subject: string;
    date: string;
    body: string;
    messageId: string;
    attachments: Array<{ filename: string; size: number; contentType: string }>;
  }> {
    const client = makeClient();
    await client.connect();
    let result: any = {};

    try {
      const lock = await client.getMailboxLock(folder);
      try {
        const msg = await client.fetchOne(`${uid}`, { uid: true, envelope: true, source: true }, { uid: true });
        const env = (msg as any).envelope;
        const source: Buffer = (msg as any).source;

        const from = env?.from?.[0] ? `${env.from[0].name || ''} <${env.from[0].address}>`.trim() : '';
        const replyTo = env?.replyTo?.[0]
          ? `${env.replyTo[0].name || ''} <${env.replyTo[0].address}>`.trim()
          : from;
        const to = env?.to?.[0] ? `${env.to[0].name || ''} <${env.to[0].address}>`.trim() : '';
        const subject = env?.subject || '(Sans objet)';
        const date = env?.date ? new Date(env.date).toLocaleString('fr-FR') : '';

        // Use mailparser for proper MIME parsing
        const parsed = await simpleParser(source);

        const messageId = parsed.messageId || '';

        // Get best text content
        let body = '';
        if (parsed.text) {
          body = parsed.text.trim().slice(0, 4000);
        } else if (parsed.html) {
          body = parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
        }

        // Extract attachments — include content buffer for PDFs so they can be parsed
        const attachments = (parsed.attachments || []).map((a: any) => ({
          filename: a.filename || 'pièce jointe',
          size: a.size || 0,
          contentType: a.contentType || 'application/octet-stream',
          content: a.content || null,  // Buffer — only kept for PDF/office docs
        }));

        result = { from, replyTo, to, subject, date, body, messageId, attachments };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }

    return result;
  },

  async sendSmtp(params: {
    to: string;
    subject: string;
    body: string;
    attachments?: { filename: string; content: Buffer; contentType: string }[];
  }): Promise<{ success: boolean; messageId?: string }> {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: getAppPassword() },
    });

    const mailOptions: any = {
      from: GMAIL_USER,
      to: params.to,
      subject: params.subject,
      text: params.body,
    };

    if (params.attachments && params.attachments.length > 0) {
      mailOptions.attachments = params.attachments.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      }));
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`[GmailSMTP] Email sent to ${params.to}, messageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  },
};

function hasAttachmentInStructure(bs: any): boolean {
  if (!bs) return false;
  if (bs.disposition === 'attachment') return true;
  if (bs.childNodes && Array.isArray(bs.childNodes)) {
    return bs.childNodes.some((child: any) => hasAttachmentInStructure(child));
  }
  return false;
}
