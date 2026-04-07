import { Router, Request, Response } from 'express';
import * as tuyaService from '../../services/tuyaService';

const router = Router();

function requireOwner(req: Request, res: Response): boolean {
  if ((req as any).isOwner !== true) {
    res.status(403).json({ error: 'Owner access required for Tuya control' });
    return false;
  }
  return true;
}

router.get('/status', async (_req: Request, res: Response) => {
  res.json({ 
    configured: tuyaService.isTuyaConfigured(),
    message: tuyaService.isTuyaConfigured() 
      ? 'Tuya configured' 
      : 'Tuya not configured. Add TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, and TUYA_UID secrets.'
  });
});

router.get('/devices', async (_req: Request, res: Response) => {
  try {
    if (!tuyaService.isTuyaConfigured()) {
      return res.status(400).json({ error: 'Tuya not configured' });
    }
    const devices = await tuyaService.getDevices();
    res.json(devices.map(d => ({
      ...d,
      categoryName: tuyaService.getCategoryName(d.category),
    })));
  } catch (error) {
    console.error('[Tuya API] Devices error:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

router.get('/devices/:deviceId/status', async (req: Request, res: Response) => {
  try {
    if (!tuyaService.isTuyaConfigured()) {
      return res.status(400).json({ error: 'Tuya not configured' });
    }
    const status = await tuyaService.getDeviceStatus(req.params.deviceId);
    res.json(status);
  } catch (error) {
    console.error('[Tuya API] Device status error:', error);
    res.status(500).json({ error: 'Failed to get device status' });
  }
});

router.post('/devices/:deviceId/command', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!tuyaService.isTuyaConfigured()) {
      return res.status(400).json({ error: 'Tuya not configured' });
    }
    const { commands } = req.body;
    if (!Array.isArray(commands)) {
      return res.status(400).json({ error: 'commands must be an array' });
    }
    const success = await tuyaService.sendCommand(req.params.deviceId, commands);
    res.json({ success });
  } catch (error) {
    console.error('[Tuya API] Command error:', error);
    res.status(500).json({ error: 'Failed to send command' });
  }
});

router.post('/devices/:deviceId/turn-on', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!tuyaService.isTuyaConfigured()) {
      return res.status(400).json({ error: 'Tuya not configured' });
    }
    const success = await tuyaService.turnOn(req.params.deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Tuya API] Turn on error:', error);
    res.status(500).json({ error: 'Failed to turn on' });
  }
});

router.post('/devices/:deviceId/turn-off', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!tuyaService.isTuyaConfigured()) {
      return res.status(400).json({ error: 'Tuya not configured' });
    }
    const success = await tuyaService.turnOff(req.params.deviceId);
    res.json({ success });
  } catch (error) {
    console.error('[Tuya API] Turn off error:', error);
    res.status(500).json({ error: 'Failed to turn off' });
  }
});

router.post('/devices/:deviceId/brightness', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!tuyaService.isTuyaConfigured()) {
      return res.status(400).json({ error: 'Tuya not configured' });
    }
    const { brightness } = req.body;
    if (typeof brightness !== 'number') {
      return res.status(400).json({ error: 'brightness must be a number (0-100)' });
    }
    const success = await tuyaService.setBrightness(req.params.deviceId, brightness);
    res.json({ success });
  } catch (error) {
    console.error('[Tuya API] Brightness error:', error);
    res.status(500).json({ error: 'Failed to set brightness' });
  }
});

router.post('/devices/:deviceId/color-temp', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!tuyaService.isTuyaConfigured()) {
      return res.status(400).json({ error: 'Tuya not configured' });
    }
    const { temperature } = req.body;
    if (typeof temperature !== 'number') {
      return res.status(400).json({ error: 'temperature must be a number (0-100)' });
    }
    const success = await tuyaService.setColorTemperature(req.params.deviceId, temperature);
    res.json({ success });
  } catch (error) {
    console.error('[Tuya API] Color temp error:', error);
    res.status(500).json({ error: 'Failed to set color temperature' });
  }
});

router.post('/devices/:deviceId/color', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!tuyaService.isTuyaConfigured()) {
      return res.status(400).json({ error: 'Tuya not configured' });
    }
    const { h, s, v } = req.body;
    if (typeof h !== 'number' || typeof s !== 'number' || typeof v !== 'number') {
      return res.status(400).json({ error: 'h, s, v must be numbers' });
    }
    const success = await tuyaService.setColor(req.params.deviceId, h, s, v);
    res.json({ success });
  } catch (error) {
    console.error('[Tuya API] Color error:', error);
    res.status(500).json({ error: 'Failed to set color' });
  }
});

router.post('/devices/:deviceId/plug', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    if (!tuyaService.isTuyaConfigured()) {
      return res.status(400).json({ error: 'Tuya not configured' });
    }
    const { on, switchIndex = 1 } = req.body;
    if (typeof on !== 'boolean') {
      return res.status(400).json({ error: 'on must be a boolean' });
    }
    const success = await tuyaService.setPlugState(req.params.deviceId, on, switchIndex);
    res.json({ success });
  } catch (error) {
    console.error('[Tuya API] Plug error:', error);
    res.status(500).json({ error: 'Failed to control plug' });
  }
});

router.get('/setup-instructions', (_req: Request, res: Response) => {
  res.json({
    instructions: `
## Configuration Tuya/Smart Life

### Étape 1: Créer un compte développeur Tuya
1. Allez sur https://iot.tuya.com
2. Créez un compte gratuit
3. Créez un projet Cloud

### Étape 2: Obtenir les credentials
1. Dans votre projet, copiez:
   - Access ID → TUYA_ACCESS_ID
   - Access Secret → TUYA_ACCESS_SECRET

### Étape 3: Lier votre compte Smart Life
1. Dans le projet Tuya IoT, allez dans "Link Tuya App Account"
2. Scannez le QR code avec l'app Smart Life/Tuya
3. Notez le UID affiché → TUYA_UID

### Étape 4: Activer les APIs
1. Dans "Service API", activez:
   - Industry Basic Service
   - Smart Home Basic Service
   - Device Control
   - Device Status Query

### Ajoutez ces 3 secrets dans Replit:
- TUYA_ACCESS_ID
- TUYA_ACCESS_SECRET
- TUYA_UID
    `,
    requiredSecrets: ['TUYA_ACCESS_ID', 'TUYA_ACCESS_SECRET', 'TUYA_UID'],
  });
});

export default router;
