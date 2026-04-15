import crypto from "crypto";

const SECRETS_KEY = process.env.SECRETS_ENCRYPTION_KEY || process.env.SESSION_SECRET;

if (!SECRETS_KEY && process.env.NODE_ENV === "production") {
  throw new Error("[DevMax] SECRETS_ENCRYPTION_KEY must be set in production. Cannot start with default encryption key.");
}

const EFFECTIVE_KEY = SECRETS_KEY || "dev-only-ulysse-devmax-key-2026";

const ENCRYPTED_PREFIX = "enc:";

function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(EFFECTIVE_KEY, salt, 32);
}

export function encryptToken(plaintext: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return ENCRYPTED_PREFIX + salt.toString("hex") + ":" + iv.toString("hex") + ":" + encrypted;
}

export function decryptToken(stored: string): string {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    return stored;
  }
  const payload = stored.slice(ENCRYPTED_PREFIX.length);
  const [saltHex, ivHex, encHex] = payload.split(":");
  if (!saltHex || !ivHex || !encHex) return stored;
  const salt = Buffer.from(saltHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return !!value && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSecret(value: string): string {
  return encryptToken(value);
}

export function decryptSecret(encrypted: string): string {
  if (!encrypted) return "***";
  if (encrypted.startsWith(ENCRYPTED_PREFIX)) {
    return decryptToken(encrypted);
  }
  const [ivHex, encHex] = encrypted.split(":");
  if (!ivHex || !encHex) return "***";
  try {
    const iv = Buffer.from(ivHex, "hex");
    const legacyKey = crypto.scryptSync(EFFECTIVE_KEY, "salt", 32);
    const decipher = crypto.createDecipheriv("aes-256-cbc", legacyKey, iv);
    let decrypted = decipher.update(encHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return "***";
  }
}
