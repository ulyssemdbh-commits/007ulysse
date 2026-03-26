import { google } from 'googleapis';
import { connectorBridge } from './connectorBridge';

let cachedToken: string | null = null;
let lastTokenFetch = 0;

async function getAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedToken && now - lastTokenFetch < 300000) {
    return cachedToken;
  }

  const conn = await connectorBridge.getGoogleMail();
  if (conn.source === 'none' || !conn.accessToken) {
    throw new Error('Google Mail not configured. Set GOOGLE_ACCESS_TOKEN (+ GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET for auto-refresh).');
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
  console.log('[GmailService] Got access token via direct API key');
  return cachedToken!;
}

async function getGmailClientWithRetry() {
  try {
    return await getGmailClient();
  } catch (err: any) {
    if (err?.message?.includes('Invalid Credentials') || err?.code === 401) {
      console.log('[GmailService] Token invalid, forcing refresh...');
      connectionSettings = null;
      lastTokenFetch = 0;
      const accessToken = await getAccessToken(true);
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      return google.gmail({ version: 'v1', auth: oauth2Client });
    }
    throw err;
  }
}

async function getGmailClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

interface MimeAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

function buildMimeMessage(params: {
  to: string;
  subject: string;
  body: string;
  attachments?: MimeAttachment[];
  inReplyTo?: string;
  references?: string;
}): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(params.subject).toString('base64')}?=`;

  const isHtml = /<[a-z][\s\S]*>/i.test(params.body);
  const attachments = params.attachments || [];
  const hasAttachments = attachments.length > 0;

  const lines: string[] = [
    `From: ulyssemdbh@gmail.com`,
    `To: ${params.to}`,
    `Subject: ${encodedSubject}`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`] : []),
    ...(params.references ? [`References: ${params.references}`] : []),
    `MIME-Version: 1.0`,
  ];

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push(``);
    lines.push(`--${boundary}`);
  }

  if (isHtml) {
    if (hasAttachments) {
      lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
      lines.push(``);
    } else {
      lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
      lines.push(``);
    }
    const plainText = params.body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    lines.push(`--${altBoundary}`);
    lines.push(`Content-Type: text/plain; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: base64`);
    lines.push(``);
    lines.push(Buffer.from(plainText).toString('base64'));
    lines.push(``);
    lines.push(`--${altBoundary}`);
    lines.push(`Content-Type: text/html; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: base64`);
    lines.push(``);
    lines.push(Buffer.from(params.body).toString('base64'));
    lines.push(``);
    lines.push(`--${altBoundary}--`);
  } else {
    if (!hasAttachments) {
      lines.push(`Content-Type: text/plain; charset="UTF-8"`);
      lines.push(`Content-Transfer-Encoding: base64`);
      lines.push(``);
      lines.push(Buffer.from(params.body).toString('base64'));
    } else {
      lines.push(`Content-Type: text/plain; charset="UTF-8"`);
      lines.push(`Content-Transfer-Encoding: base64`);
      lines.push(``);
      lines.push(Buffer.from(params.body).toString('base64'));
    }
  }

  if (hasAttachments) {
    for (const att of attachments) {
      const b64 = att.content.toString('base64');
      const encodedFilename = `=?UTF-8?B?${Buffer.from(att.filename).toString('base64')}?=`;
      lines.push(``);
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${att.contentType}; name="${encodedFilename}"`);
      lines.push(`Content-Transfer-Encoding: base64`);
      lines.push(`Content-Disposition: attachment; filename="${encodedFilename}"`);
      lines.push(``);
      for (let i = 0; i < b64.length; i += 76) {
        lines.push(b64.slice(i, i + 76));
      }
    }
    lines.push(``);
    lines.push(`--${boundary}--`);
  }

  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const googleMailService = {
  async isConnected(): Promise<boolean> {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return false;
      return true;
    } catch (err: any) {
      console.log(`[GmailService] isConnected check failed: ${err.message}`);
      return false;
    }
  },

  async getProfile(): Promise<{ email: string }> {
    const gmail = await getGmailClientWithRetry();
    const profile: any = await gmail.users.getProfile({ userId: 'me' });
    return { email: profile.data.emailAddress || '' };
  },

  async listMessages(params: { maxResults?: number; query?: string } = {}): Promise<{
    id: string;
    from: string;
    subject: string;
    date: string;
    snippet: string;
    unread: boolean;
  }[]> {
    const gmail = await getGmailClientWithRetry();
    const { maxResults = 10, query = '' } = params;

    const listRes: any = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query || 'in:inbox',
    });

    const messages = listRes.data.messages || [];
    const results = [];

    for (const msg of messages) {
      try {
        const detail: any = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const headers: { name: string; value: string }[] = detail.data.payload?.headers || [];
        const get = (name: string) => headers.find((h: any) => h.name === name)?.value || '';
        const unread = (detail.data.labelIds || []).includes('UNREAD');

        results.push({
          id: msg.id,
          from: get('From'),
          subject: get('Subject'),
          date: get('Date'),
          snippet: detail.data.snippet || '',
          unread,
        });
      } catch {
        // skip unreadable messages
      }
    }

    return results;
  },

  async getMessage(messageId: string): Promise<{
    from: string;
    to: string;
    subject: string;
    date: string;
    body: string;
    messageId?: string;
    attachments?: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }>;
  }> {
    const gmail = await getGmailClientWithRetry();
    const detail: any = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers: { name: string; value: string }[] = detail.data.payload?.headers || [];
    const get = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

    const extractBody = (payload: any): string => {
      if (!payload) return '';
      if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }
      if (payload.parts) {
        for (const part of payload.parts) {
          const text = part.mimeType === 'text/plain' ? extractBody(part) : '';
          if (text) return text;
        }
        for (const part of payload.parts) {
          const text = extractBody(part);
          if (text) return text;
        }
      }
      return '';
    };

    const extractAttachments = (payload: any, gmailMsgId: string): Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> => {
      const result: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> = [];
      if (!payload) return result;
      if (payload.filename && payload.body?.attachmentId) {
        result.push({
          filename: payload.filename,
          mimeType: payload.mimeType || 'application/octet-stream',
          size: payload.body.size || 0,
          attachmentId: payload.body.attachmentId,
        });
      }
      if (payload.parts) {
        for (const part of payload.parts) {
          result.push(...extractAttachments(part, gmailMsgId));
        }
      }
      return result;
    };

    return {
      from: get('From'),
      to: get('To'),
      subject: get('Subject'),
      date: get('Date'),
      body: extractBody(detail.data.payload),
      messageId: get('Message-ID') || get('Message-Id'),
      attachments: extractAttachments(detail.data.payload, messageId),
    };
  },

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const gmail = await getGmailClientWithRetry();
    const res: any = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });
    const data = res.data.data || '';
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  },

  async sendWithAttachment(params: {
    to: string;
    subject: string;
    body: string;
    attachment?: { filename: string; content: Buffer; contentType: string };
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }): Promise<{ success: boolean; messageId?: string }> {
    const gmail = await getGmailClientWithRetry();
    const allAttachments: MimeAttachment[] = [];
    if (params.attachments && params.attachments.length > 0) {
      allAttachments.push(...params.attachments);
    } else if (params.attachment) {
      allAttachments.push(params.attachment);
    }
    const raw = buildMimeMessage({ ...params, attachments: allAttachments.length > 0 ? allAttachments : undefined });
    const result: any = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });
    console.log(`[GmailService] Email sent, id: ${result.data.id}, attachments: ${allAttachments.length}`);
    return { success: true, messageId: result.data.id };
  },

  async sendReply(params: {
    to: string;
    subject: string;
    body: string;
    inReplyTo: string;
    originalBody?: string;
    originalFrom?: string;
    originalDate?: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }): Promise<{ success: boolean; messageId?: string }> {
    const gmail = await getGmailClientWithRetry();
    const replySubject = params.subject.startsWith('Re:') ? params.subject : `Re: ${params.subject}`;
    const quotedOriginal = params.originalBody
      ? `\n\n--- Message original de ${params.originalFrom || ''} (${params.originalDate || ''}) ---\n${params.originalBody.slice(0, 1500)}`
      : '';
    const fullBody = `${params.body}${quotedOriginal}`;
    const raw = buildMimeMessage({
      to: params.to,
      subject: replySubject,
      body: fullBody,
      inReplyTo: params.inReplyTo,
      references: params.inReplyTo,
      attachments: params.attachments,
    });
    const result: any = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });
    console.log('[GmailService] Reply sent, id:', result.data.id);
    return { success: true, messageId: result.data.id };
  },

  async sendForward(params: {
    to: string;
    subject: string;
    forwardNote: string;
    originalFrom: string;
    originalDate: string;
    originalBody: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }): Promise<{ success: boolean; messageId?: string }> {
    const gmail = await getGmailClientWithRetry();
    const fwdSubject = params.subject.startsWith('Fwd:') ? params.subject : `Fwd: ${params.subject}`;
    const body = `${params.forwardNote}\n\n---------- Message transféré ----------\nDe : ${params.originalFrom}\nDate : ${params.originalDate}\n\n${params.originalBody.slice(0, 2000)}`;
    const raw = buildMimeMessage({ to: params.to, subject: fwdSubject, body, attachments: params.attachments });
    const result: any = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });
    console.log('[GmailService] Forward sent, id:', result.data.id);
    return { success: true, messageId: result.data.id };
  },

  async markAsRead(messageId: string): Promise<void> {
    const gmail = await getGmailClientWithRetry();
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] }
    });
  },

  async archiveMessage(messageId: string): Promise<void> {
    const gmail = await getGmailClientWithRetry();
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['INBOX'] }
    });
  },

  async trashMessage(messageId: string): Promise<void> {
    const gmail = await getGmailClientWithRetry();
    await gmail.users.messages.trash({
      userId: 'me',
      id: messageId,
    });
  },

  async searchMessages(query: string, maxResults: number = 10): Promise<{
    id: string;
    from: string;
    subject: string;
    date: string;
    snippet: string;
    unread: boolean;
  }[]> {
    return this.listMessages({ query, maxResults });
  },

  async getUnreadCount(): Promise<number> {
    const gmail = await getGmailClientWithRetry();
    const res: any = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread in:inbox',
      maxResults: 1,
    });
    return res.data.resultSizeEstimate || 0;
  },
};
