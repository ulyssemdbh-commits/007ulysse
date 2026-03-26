import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { discordBotService } from '../services/discordBotService';
import { discordVoiceMetrics } from '../services/discordVoiceMetricsService';

const router = Router();

router.get('/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const isReady = discordBotService.isReady();
    const botUsername = discordBotService.getBotUsername();
    const guilds = await discordBotService.getGuilds();
    
    res.json({
      connected: isReady,
      botUsername,
      guilds
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/channels/:guildId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const channels = await discordBotService.getChannels(guildId);
    res.json({ channels });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const { channelId, message } = req.body;
    
    if (!channelId || !message) {
      return res.status(400).json({ error: 'channelId and message are required' });
    }
    
    const success = await discordBotService.sendMessage(channelId, message);
    
    if (success) {
      res.json({ success: true, message: 'Message sent' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to send message' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/internal-test', async (_req: Request, res: Response) => {
  try {
    const guilds = await discordBotService.getGuilds();
    if (guilds.length === 0) return res.status(400).json({ error: 'Bot not in any server' });
    const channels = await discordBotService.getChannels(guilds[0].id);
    const textChannel = channels.find(c => c.name === 'général' || c.name === 'general');
    if (!textChannel) return res.status(400).json({ error: 'No general channel found' });
    const success = await discordBotService.sendMessage(textChannel.id, '🤖 Nouveau test depuis Ulysse ! Tout fonctionne parfaitement. À ton service Maurice !');
    res.json({ success, guild: guilds[0].name, channel: textChannel.name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/test', requireAuth, async (_req: Request, res: Response) => {
  try {
    const guilds = await discordBotService.getGuilds();
    
    if (guilds.length === 0) {
      return res.status(400).json({ error: 'Bot not in any server' });
    }
    
    const channels = await discordBotService.getChannels(guilds[0].id);
    const textChannel = channels.find(c => c.name === 'général' || c.name === 'general');
    
    if (!textChannel) {
      return res.status(400).json({ error: 'No general channel found', channels });
    }
    
    const success = await discordBotService.sendMessage(
      textChannel.id, 
      '🧠 Message test depuis Ulysse ! Le bot Discord est opérationnel.'
    );
    
    res.json({ 
      success, 
      guild: guilds[0].name,
      channel: textChannel.name,
      channelId: textChannel.id
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Voice metrics endpoints
router.get('/voice/metrics', requireAuth, async (_req: Request, res: Response) => {
  try {
    const metrics = discordVoiceMetrics.getGlobalMetrics();
    res.json(metrics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/voice/profiles', requireAuth, async (_req: Request, res: Response) => {
  try {
    const profiles = discordVoiceMetrics.getAllProfiles();
    res.json({ profiles });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/voice/profile/:discordId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { discordId } = req.params;
    const profile = discordVoiceMetrics.getUserProfile(discordId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    const brainContext = discordVoiceMetrics.generateBrainContext(discordId);
    res.json({ profile, brainContext });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/voice/sessions', requireAuth, async (_req: Request, res: Response) => {
  try {
    const recentSessions = discordVoiceMetrics.getRecentSessions(10);
    res.json({ sessions: recentSessions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
