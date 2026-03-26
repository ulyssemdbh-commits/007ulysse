const IFTTT_WEBHOOKS_URL = 'https://maker.ifttt.com/trigger';

interface IftttConfig {
  webhookKey: string;
}

function getConfig(): IftttConfig | null {
  const webhookKey = process.env.IFTTT_WEBHOOK_KEY;
  if (!webhookKey) return null;
  return { webhookKey };
}

export function isIftttConfigured(): boolean {
  return getConfig() !== null;
}

export interface IftttTriggerResult {
  success: boolean;
  message?: string;
}

export async function trigger(
  eventName: string,
  value1?: string,
  value2?: string,
  value3?: string
): Promise<IftttTriggerResult> {
  const config = getConfig();
  if (!config) {
    return { success: false, message: 'IFTTT not configured' };
  }
  
  const url = `${IFTTT_WEBHOOKS_URL}/${eventName}/with/key/${config.webhookKey}`;
  
  const body: Record<string, string> = {};
  if (value1) body.value1 = value1;
  if (value2) body.value2 = value2;
  if (value3) body.value3 = value3;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    if (response.ok) {
      return { success: true, message: 'Trigger sent successfully' };
    } else {
      const text = await response.text();
      return { success: false, message: `IFTTT error: ${text}` };
    }
  } catch (error) {
    console.error('[IFTTT] Trigger error:', error);
    return { success: false, message: 'Failed to trigger IFTTT event' };
  }
}

export const presetEvents = {
  googleHomeAnnounce: (message: string) => trigger('google_announce', message),
  googleHomeBroadcast: (message: string) => trigger('google_broadcast', message),
  alexaAnnounce: (message: string) => trigger('alexa_announce', message),
  alexaRoutine: (routineName: string) => trigger('alexa_routine', routineName),
  lightsOn: (room?: string) => trigger('lights_on', room),
  lightsOff: (room?: string) => trigger('lights_off', room),
  sceneActivate: (sceneName: string) => trigger('scene_activate', sceneName),
  thermostatSet: (temperature: string) => trigger('thermostat_set', temperature),
  lockDoor: () => trigger('lock_door'),
  unlockDoor: () => trigger('unlock_door'),
  alarmArm: (mode?: string) => trigger('alarm_arm', mode),
  alarmDisarm: () => trigger('alarm_disarm'),
  playMusic: (query?: string) => trigger('play_music', query),
  pauseMusic: () => trigger('pause_music'),
  customAction: (action: string, param1?: string, param2?: string) => trigger('custom_action', action, param1, param2),
};

export interface IftttApplet {
  eventName: string;
  displayName: string;
  description: string;
  category: 'voice' | 'lights' | 'thermostat' | 'security' | 'music' | 'custom';
  parameters: { name: string; description: string }[];
}

export const recommendedApplets: IftttApplet[] = [
  {
    eventName: 'google_announce',
    displayName: 'Google Home Announce',
    description: 'Faire une annonce vocale sur Google Home',
    category: 'voice',
    parameters: [{ name: 'message', description: 'Message à annoncer' }],
  },
  {
    eventName: 'google_broadcast',
    displayName: 'Google Home Broadcast',
    description: 'Diffuser un message sur tous les Google Home',
    category: 'voice',
    parameters: [{ name: 'message', description: 'Message à diffuser' }],
  },
  {
    eventName: 'alexa_announce',
    displayName: 'Alexa Announce',
    description: 'Faire une annonce vocale sur Alexa',
    category: 'voice',
    parameters: [{ name: 'message', description: 'Message à annoncer' }],
  },
  {
    eventName: 'alexa_routine',
    displayName: 'Alexa Routine',
    description: 'Déclencher une routine Alexa',
    category: 'voice',
    parameters: [{ name: 'routine', description: 'Nom de la routine' }],
  },
  {
    eventName: 'lights_on',
    displayName: 'Allumer lumières',
    description: 'Allumer les lumières via Google/Alexa',
    category: 'lights',
    parameters: [{ name: 'room', description: 'Pièce (optionnel)' }],
  },
  {
    eventName: 'lights_off',
    displayName: 'Éteindre lumières',
    description: 'Éteindre les lumières via Google/Alexa',
    category: 'lights',
    parameters: [{ name: 'room', description: 'Pièce (optionnel)' }],
  },
  {
    eventName: 'scene_activate',
    displayName: 'Activer scène',
    description: 'Activer une scène d\'éclairage',
    category: 'lights',
    parameters: [{ name: 'scene', description: 'Nom de la scène' }],
  },
  {
    eventName: 'thermostat_set',
    displayName: 'Régler thermostat',
    description: 'Changer la température du thermostat',
    category: 'thermostat',
    parameters: [{ name: 'temperature', description: 'Température en °C' }],
  },
  {
    eventName: 'alarm_arm',
    displayName: 'Armer alarme',
    description: 'Activer le système d\'alarme',
    category: 'security',
    parameters: [{ name: 'mode', description: 'Mode (home/away)' }],
  },
  {
    eventName: 'alarm_disarm',
    displayName: 'Désarmer alarme',
    description: 'Désactiver le système d\'alarme',
    category: 'security',
    parameters: [],
  },
  {
    eventName: 'play_music',
    displayName: 'Jouer musique',
    description: 'Lancer de la musique sur les enceintes',
    category: 'music',
    parameters: [{ name: 'query', description: 'Artiste, album ou playlist' }],
  },
  {
    eventName: 'pause_music',
    displayName: 'Pause musique',
    description: 'Mettre la musique en pause',
    category: 'music',
    parameters: [],
  },
];

export function getSetupInstructions(): string {
  return `
## Configuration IFTTT Webhooks

1. Créez un compte IFTTT sur https://ifttt.com
2. Allez sur https://ifttt.com/maker_webhooks
3. Cliquez sur "Documentation" pour obtenir votre clé webhook
4. Ajoutez la clé dans les secrets: IFTTT_WEBHOOK_KEY

### Création d'applets recommandés

Pour chaque applet, créez une nouvelle applet:
- Trigger: Webhooks → Receive a web request
- Event name: (voir liste ci-dessous)
- Action: Google Assistant, Alexa, etc.

### Events recommandés:
${recommendedApplets.map(a => `- ${a.eventName}: ${a.description}`).join('\n')}

### Test webhook:
curl -X POST https://maker.ifttt.com/trigger/{event}/with/key/{your_key} -H "Content-Type: application/json" -d '{"value1":"test"}'
`;
}
