import { describe, test, expect, beforeAll } from './testUtils';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5000';

let authCookie: string = '';

describe('Authentication API', () => {
  test('POST /api/login - should reject invalid credentials', async () => {
    const response = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'invalid', password: 'wrong' })
    });
    expect(response.status).toBe(401);
  });

  test('GET /api/user - should return 401 when not authenticated', async () => {
    const response = await fetch(`${BASE_URL}/api/user`);
    expect(response.status).toBe(401);
  });

  test('GET / - app should be accessible', async () => {
    const response = await fetch(`${BASE_URL}/`);
    expect(response.status).toBe(200);
  });
});

describe('Gmail API', () => {
  test('GET /api/gmail/auth-url - should require authentication', async () => {
    const response = await fetch(`${BASE_URL}/api/gmail/auth-url`);
    expect(response.status).toBe(401);
  });

  test('GET /api/gmail/messages - should require authentication', async () => {
    const response = await fetch(`${BASE_URL}/api/gmail/messages`);
    expect(response.status).toBe(401);
  });
});

describe('Chat API', () => {
  test('POST /api/chat - should require authentication', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' })
    });
    expect(response.status).toBe(401);
  });

  test('GET /api/conversations - should require authentication', async () => {
    const response = await fetch(`${BASE_URL}/api/conversations`);
    expect(response.status).toBe(401);
  });
});

describe('V2 API', () => {
  test('GET /api/v2/health - should return 200', async () => {
    const response = await fetch(`${BASE_URL}/api/v2/health`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  test('POST /api/v2/devices/register - should reject invalid credentials', async () => {
    const response = await fetch(`${BASE_URL}/api/v2/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username: 'invalid', 
        password: 'wrong', 
        deviceName: 'test-device',
        deviceIdentifier: 'test-id-12345'
      })
    });
    expect(response.status).toBe(401);
  });

  test('GET /api/v2/conversations - should require authentication', async () => {
    const response = await fetch(`${BASE_URL}/api/v2/conversations`);
    expect(response.status).toBe(401);
  });
});

describe('Media API', () => {
  test('GET /api/media - should require authentication', async () => {
    const response = await fetch(`${BASE_URL}/api/media`);
    expect(response.status).toBe(401);
  });
});

describe('Encryption Service', () => {
  test('should encrypt and decrypt values correctly', async () => {
    const crypto = await import('crypto');
    const testValue = 'test-oauth-token-12345';
    
    const ALGORITHM = 'aes-256-gcm';
    const IV_LENGTH = 16;
    
    const testKey = crypto.randomBytes(32).toString('hex');
    const salt = crypto.createHash('sha256').update('gmail-tokens-salt').digest();
    const key = crypto.pbkdf2Sync(testKey, salt, 100000, 32, 'sha256');
    
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(testValue, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    const ciphertext = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    
    const parts = ciphertext.split(':');
    const decIv = Buffer.from(parts[0], 'hex');
    const decAuthTag = Buffer.from(parts[1], 'hex');
    const encryptedData = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, decIv);
    decipher.setAuthTag(decAuthTag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    expect(decrypted).toBe(testValue);
  });
});
