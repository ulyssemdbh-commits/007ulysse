import crypto from 'crypto';

const TUYA_CLOUD_URL = 'https://openapi.tuyaeu.com';

interface TuyaConfig {
  accessId: string;
  accessSecret: string;
  uid?: string;
}

let cachedToken: { access_token: string; expire_time: number } | null = null;

function getConfig(): TuyaConfig | null {
  const accessId = process.env.TUYA_ACCESS_ID;
  const accessSecret = process.env.TUYA_ACCESS_SECRET;
  
  if (!accessId || !accessSecret) return null;
  
  return {
    accessId,
    accessSecret,
    uid: process.env.TUYA_UID,
  };
}

export function isTuyaConfigured(): boolean {
  return getConfig() !== null;
}

function generateSign(
  accessId: string,
  accessSecret: string,
  timestamp: string,
  token: string = '',
  nonce: string = '',
  method: string = 'GET',
  path: string = '',
  body: string = ''
): string {
  const contentHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const stringToSign = [method, contentHash, '', path].join('\n');
  const signStr = accessId + token + timestamp + nonce + stringToSign;
  
  return crypto
    .createHmac('sha256', accessSecret)
    .update(signStr)
    .digest('hex')
    .toUpperCase();
}

async function getAccessToken(): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error('Tuya not configured');
  
  if (cachedToken && cachedToken.expire_time > Date.now()) {
    return cachedToken.access_token;
  }
  
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const path = '/v1.0/token?grant_type=1';
  
  const sign = generateSign(
    config.accessId,
    config.accessSecret,
    timestamp,
    '',
    nonce,
    'GET',
    path
  );
  
  const response = await fetch(`${TUYA_CLOUD_URL}${path}`, {
    method: 'GET',
    headers: {
      'client_id': config.accessId,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': timestamp,
      'nonce': nonce,
    },
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(`Tuya auth failed: ${data.msg}`);
  }
  
  cachedToken = {
    access_token: data.result.access_token,
    expire_time: Date.now() + (data.result.expire_time * 1000) - 60000,
  };
  
  return cachedToken.access_token;
}

async function tuyaRequest(
  method: string,
  path: string,
  body?: any
): Promise<any> {
  const config = getConfig();
  if (!config) throw new Error('Tuya not configured');
  
  const token = await getAccessToken();
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyStr = body ? JSON.stringify(body) : '';
  
  const sign = generateSign(
    config.accessId,
    config.accessSecret,
    timestamp,
    token,
    nonce,
    method,
    path,
    bodyStr
  );
  
  const headers: Record<string, string> = {
    'client_id': config.accessId,
    'access_token': token,
    'sign': sign,
    'sign_method': 'HMAC-SHA256',
    't': timestamp,
    'nonce': nonce,
  };
  
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  
  const response = await fetch(`${TUYA_CLOUD_URL}${path}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });
  
  return response.json();
}

export interface TuyaDevice {
  id: string;
  name: string;
  category: string;
  productName: string;
  online: boolean;
  icon: string;
  status: TuyaDeviceStatus[];
}

export interface TuyaDeviceStatus {
  code: string;
  value: any;
}

export async function getDevices(): Promise<TuyaDevice[]> {
  const config = getConfig();
  if (!config?.uid) {
    console.log('[Tuya] No UID configured, cannot list devices');
    return [];
  }
  
  try {
    const result = await tuyaRequest('GET', `/v1.0/users/${config.uid}/devices`);
    
    if (!result.success) {
      console.error('[Tuya] Failed to get devices:', result.msg);
      return [];
    }
    
    return result.result.map((d: any) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      productName: d.product_name,
      online: d.online,
      icon: d.icon,
      status: d.status || [],
    }));
  } catch (error) {
    console.error('[Tuya] Error getting devices:', error);
    return [];
  }
}

export async function getDeviceStatus(deviceId: string): Promise<TuyaDeviceStatus[]> {
  try {
    const result = await tuyaRequest('GET', `/v1.0/devices/${deviceId}/status`);
    
    if (!result.success) {
      console.error('[Tuya] Failed to get device status:', result.msg);
      return [];
    }
    
    return result.result;
  } catch (error) {
    console.error('[Tuya] Error getting device status:', error);
    return [];
  }
}

export async function sendCommand(deviceId: string, commands: { code: string; value: any }[]): Promise<boolean> {
  try {
    const result = await tuyaRequest('POST', `/v1.0/devices/${deviceId}/commands`, { commands });
    
    if (!result.success) {
      console.error('[Tuya] Failed to send command:', result.msg);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('[Tuya] Error sending command:', error);
    return false;
  }
}

export async function turnOn(deviceId: string): Promise<boolean> {
  return sendCommand(deviceId, [{ code: 'switch_led', value: true }]);
}

export async function turnOff(deviceId: string): Promise<boolean> {
  return sendCommand(deviceId, [{ code: 'switch_led', value: false }]);
}

export async function setBrightness(deviceId: string, brightness: number): Promise<boolean> {
  const value = Math.max(10, Math.min(1000, Math.round(brightness * 10)));
  return sendCommand(deviceId, [{ code: 'bright_value_v2', value }]);
}

export async function setColorTemperature(deviceId: string, temperature: number): Promise<boolean> {
  const value = Math.max(0, Math.min(1000, Math.round(temperature * 10)));
  return sendCommand(deviceId, [{ code: 'temp_value_v2', value }]);
}

export async function setColor(deviceId: string, h: number, s: number, v: number): Promise<boolean> {
  return sendCommand(deviceId, [{
    code: 'colour_data_v2',
    value: { h: Math.round(h), s: Math.round(s * 10), v: Math.round(v * 10) }
  }]);
}

export async function setPlugState(deviceId: string, on: boolean, switchIndex: number = 1): Promise<boolean> {
  return sendCommand(deviceId, [{ code: `switch_${switchIndex}`, value: on }]);
}

export function getCategoryName(category: string): string {
  const categories: Record<string, string> = {
    'dj': 'Ampoule',
    'dd': 'Prise',
    'cz': 'Prise',
    'pc': 'Multiprise',
    'kg': 'Interrupteur',
    'tgq': 'Variateur',
    'xdd': 'Plafonnier',
    'fwd': 'Bande LED',
    'dc': 'Rideau',
    'kfj': 'Climatiseur',
    'kt': 'Thermostat',
    'wk': 'Purificateur',
    'sp': 'Caméra',
    'pir': 'Capteur mouvement',
    'mcs': 'Capteur contact',
    'wsdcg': 'Capteur temp/humidité',
    'ywbj': 'Détecteur fumée',
    'rqbj': 'Détecteur gaz',
    'sj': 'Détecteur eau',
    'sos': 'Bouton SOS',
  };
  return categories[category] || category;
}
