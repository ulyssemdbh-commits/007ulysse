import { Router, Request, Response } from 'express';
import * as iftttService from '../../services/iftttService';

const router = Router();

function requireOwner(req: Request, res: Response): boolean {
  if ((req as any).isOwner !== true) {
    res.status(403).json({ error: 'Owner access required for IFTTT control' });
    return false;
  }
  return true;
}

router.get('/status', async (_req: Request, res: Response) => {
  res.json({ 
    configured: iftttService.isIftttConfigured(),
    message: iftttService.isIftttConfigured() 
      ? 'IFTTT configured' 
      : 'IFTTT not configured. Add IFTTT_WEBHOOK_KEY secret.'
  });
});

router.post('/trigger', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { eventName, value1, value2, value3 } = req.body;
    if (!eventName) {
      return res.status(400).json({ error: 'eventName is required' });
    }
    const result = await iftttService.trigger(eventName, value1, value2, value3);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Trigger error:', error);
    res.status(500).json({ error: 'Failed to trigger event' });
  }
});

router.post('/google/announce', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }
    const result = await iftttService.presetEvents.googleHomeAnnounce(message);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Google announce error:', error);
    res.status(500).json({ error: 'Failed to announce' });
  }
});

router.post('/google/broadcast', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }
    const result = await iftttService.presetEvents.googleHomeBroadcast(message);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Google broadcast error:', error);
    res.status(500).json({ error: 'Failed to broadcast' });
  }
});

router.post('/alexa/announce', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }
    const result = await iftttService.presetEvents.alexaAnnounce(message);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Alexa announce error:', error);
    res.status(500).json({ error: 'Failed to announce' });
  }
});

router.post('/alexa/routine', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { routineName } = req.body;
    if (!routineName) {
      return res.status(400).json({ error: 'routineName is required' });
    }
    const result = await iftttService.presetEvents.alexaRoutine(routineName);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Alexa routine error:', error);
    res.status(500).json({ error: 'Failed to trigger routine' });
  }
});

router.post('/lights/on', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { room } = req.body;
    const result = await iftttService.presetEvents.lightsOn(room);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Lights on error:', error);
    res.status(500).json({ error: 'Failed to turn on lights' });
  }
});

router.post('/lights/off', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { room } = req.body;
    const result = await iftttService.presetEvents.lightsOff(room);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Lights off error:', error);
    res.status(500).json({ error: 'Failed to turn off lights' });
  }
});

router.post('/scene/activate', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { sceneName } = req.body;
    if (!sceneName) {
      return res.status(400).json({ error: 'sceneName is required' });
    }
    const result = await iftttService.presetEvents.sceneActivate(sceneName);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Scene error:', error);
    res.status(500).json({ error: 'Failed to activate scene' });
  }
});

router.post('/thermostat/set', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { temperature } = req.body;
    if (!temperature) {
      return res.status(400).json({ error: 'temperature is required' });
    }
    const result = await iftttService.presetEvents.thermostatSet(String(temperature));
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Thermostat error:', error);
    res.status(500).json({ error: 'Failed to set thermostat' });
  }
});

router.post('/alarm/arm', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { mode } = req.body;
    const result = await iftttService.presetEvents.alarmArm(mode);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Alarm arm error:', error);
    res.status(500).json({ error: 'Failed to arm alarm' });
  }
});

router.post('/alarm/disarm', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const result = await iftttService.presetEvents.alarmDisarm();
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Alarm disarm error:', error);
    res.status(500).json({ error: 'Failed to disarm alarm' });
  }
});

router.post('/music/play', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const { query } = req.body;
    const result = await iftttService.presetEvents.playMusic(query);
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Music play error:', error);
    res.status(500).json({ error: 'Failed to play music' });
  }
});

router.post('/music/pause', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!iftttService.isIftttConfigured()) {
      return res.status(400).json({ error: 'IFTTT not configured' });
    }
    const result = await iftttService.presetEvents.pauseMusic();
    res.json(result);
  } catch (error) {
    console.error('[IFTTT API] Music pause error:', error);
    res.status(500).json({ error: 'Failed to pause music' });
  }
});

router.get('/applets', (_req: Request, res: Response) => {
  res.json(iftttService.recommendedApplets);
});

router.get('/setup-instructions', (_req: Request, res: Response) => {
  res.json({
    instructions: iftttService.getSetupInstructions(),
    requiredSecrets: ['IFTTT_WEBHOOK_KEY'],
  });
});

export default router;
