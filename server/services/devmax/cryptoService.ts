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
  // Decrypt to Buffer first, then validate before stringifying.
  // Decrypting straight to "utf8" silently substitutes invalid bytes with U+FFFD,
  // producing tokens that look valid but explode later in HTTP headers (ByteString error).
  const decryptedBuf = Buffer.concat([decipher.update(encHex, "hex"), decipher.final()]);
  const decrypted = decryptedBuf.toString("utf8");
  // GitHub PATs (ghp_*, github_pat_*, gho_*, ghs_*) are strict ASCII printable.
  // If we see U+FFFD or any non-ASCII byte, decryption succeeded numerically but
  // produced garbage — almost always means the encryption key rotated since this
  // ciphertext was written. Fail loud so callers can re-prompt for a fresh token.
  if (decrypted.includes("\uFFFD") || /[^\x20-\x7E]/.test(decrypted)) {
    throw new Error(
      "[crypto] Decrypted token contains invalid bytes — encryption key likely rotated. " +
      "Re-enter the GitHub token in DevMax to re-encrypt it with the current key."
    );
  }
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
