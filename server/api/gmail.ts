import { Router, Request, Response } from 'express';
import { gmailImapService } from '../services/gmailImapService';
import { googleMailService } from '../services/googleMailService';

const router = Router();

const GMAIL_ADDRESS = 'ulyssemdbh@gmail.com';

router.get('/status', async (req: Request, res: Response) => {
  try {
    const connected = await gmailImapService.isConnected();
    res.json({ connected, email: connected ? GMAIL_ADDRESS : undefined });
  } catch (error: any) {
    console.error('[Gmail API] Status error:', error?.message);
    res.json({ connected: false, error: error?.message });
  }
});

router.get('/messages', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.isOwner) {
      return res.status(403).json({ error: 'Owner access required' });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const messages = await gmailImapService.listMessages({ maxResults: limit });
    res.json(messages.map(m => ({
      id: String(m.uid),
      from: m.from,
      subject: m.subject,
      date: m.date,
      snippet: m.snippet,
      unread: m.unread,
      hasAttachments: m.hasAttachments,
    })));
  } catch (error: any) {
    console.error('[Gmail API] List messages error:', error?.message);
    res.status(500).json({ error: error?.message || 'Failed to list messages' });
  }
});

router.get('/messages/:uid', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.isOwner) {
      return res.status(403).json({ error: 'Owner access required' });
    }
    const uid = parseInt(req.params.uid);
    if (isNaN(uid)) {
      return res.status(400).json({ error: 'Invalid message UID' });
    }
    const detail = await gmailImapService.getMessage(uid);
    res.json(detail);
  } catch (error: any) {
    console.error('[Gmail API] Get message error:', error?.message);
    res.status(500).json({ error: error?.message || 'Failed to get message' });
  }
});

router.post('/send', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.isOwner) {
      return res.status(403).json({ error: 'Owner access required' });
    }
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
    }
    const result = await googleMailService.sendWithAttachment({ to, subject, body });
    res.json(result);
  } catch (error: any) {
    console.error('[Gmail API] Send error:', error?.message);
    res.status(500).json({ error: error?.message || 'Failed to send email' });
  }
});

router.post('/reply/:uid', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.isOwner) {
      return res.status(403).json({ error: 'Owner access required' });
    }
    const { body } = req.body;
    if (!body) {
      return res.status(400).json({ error: 'Missing required field: body' });
    }
    const uid = parseInt(req.params.uid);
    if (isNaN(uid)) {
      return res.status(400).json({ error: 'Invalid message UID' });
    }
    const original = await gmailImapService.getMessage(uid);
    const replyTo = original.replyTo || original.from;
    const result = await googleMailService.sendReply({
      to: replyTo,
      subject: original.subject,
      body,
      inReplyTo: original.messageId,
      originalBody: original.body,
      originalFrom: original.from,
      originalDate: original.date,
    });
    res.json(result);
  } catch (error: any) {
    console.error('[Gmail API] Reply error:', error?.message);
    res.status(500).json({ error: error?.message || 'Failed to send reply' });
  }
});

export default router;
