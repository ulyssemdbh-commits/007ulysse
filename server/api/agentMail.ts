// AgentMail API Routes
import { Router, Request, Response } from 'express';
import { agentMailService, PersonaType } from '../services/agentMailService';

const router = Router();

// Helper to determine persona based on user type
function getPersonaFromUser(user: any): PersonaType {
  if (!user) return 'ulysse';
  if (user.isOwner) return 'ulysse';
  if (user.role === 'external') return 'alfred';
  return 'iris';
}

// Status check
router.get('/status', async (req: Request, res: Response) => {
  try {
    const isConnected = await agentMailService.isConnected();
    const user = (req as any).user;
    const persona = getPersonaFromUser(user);
    
    if (isConnected) {
      try {
        const inboxAddress = await agentMailService.getInboxAddress(persona);
        return res.json({ 
          connected: true, 
          email: inboxAddress,
          persona: persona,
          source: 'agentmail'
        });
      } catch (error: any) {
        return res.json({ 
          connected: true, 
          email: 'AgentMail connecté',
          persona: persona,
          source: 'agentmail'
        });
      }
    }
    
    res.json({ connected: false });
  } catch (error: any) {
    console.error('[AGENTMAIL] Status error:', error);
    res.json({ connected: false, error: error.message });
  }
});

// Get inbox address
router.get('/inbox', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const persona = getPersonaFromUser(user);
    const inbox = await agentMailService.getOrCreateInboxForPersona(persona);
    res.json({ inbox });
  } catch (error: any) {
    console.error('[AGENTMAIL] Get inbox error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List email threads
router.get('/threads', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const persona = getPersonaFromUser(user);
    const limit = parseInt(req.query.limit as string) || 20;
    const threads = await agentMailService.listThreads(limit, persona);
    
    res.json({ threads });
  } catch (error: any) {
    console.error('[AGENTMAIL] List threads error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get thread with messages
router.get('/threads/:threadId', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const persona = getPersonaFromUser(user);
    const result = await agentMailService.getThread(req.params.threadId, persona);
    res.json(result);
  } catch (error: any) {
    console.error('[AGENTMAIL] Get thread error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send email
router.post('/send', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const persona = getPersonaFromUser(user);
    const { to, subject, body } = req.body;
    
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
    }
    
    const result = await agentMailService.sendEmail({ to, subject, body }, persona);
    res.json(result);
  } catch (error: any) {
    console.error('[AGENTMAIL] Send email error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reply to message
router.post('/reply/:messageId', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const persona = getPersonaFromUser(user);
    const { body } = req.body;
    
    if (!body) {
      return res.status(400).json({ error: 'Missing required field: body' });
    }
    
    const result = await agentMailService.replyToMessage(req.params.messageId, body, persona);
    res.json(result);
  } catch (error: any) {
    console.error('[AGENTMAIL] Reply error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get unread count
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const persona = getPersonaFromUser(user);
    const count = await agentMailService.getUnreadCount(persona);
    res.json({ unreadCount: count });
  } catch (error: any) {
    console.error('[AGENTMAIL] Unread count error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download attachment
router.get('/attachments/:messageId/:attachmentId', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Use the correct persona based on user type for proper inbox isolation
    const persona = getPersonaFromUser(user);
    
    const { messageId, attachmentId } = req.params;
    const attachment = await agentMailService.getAttachment(messageId, attachmentId, persona);
    
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
    res.send(attachment.content);
  } catch (error: any) {
    console.error('[AGENTMAIL] Download attachment error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
