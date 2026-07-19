import * as bcrypt from "bcrypt";
import * as crypto from "crypto";

const SALT_ROUNDS = 12;
const GCM_NONCE_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const CBC_IV_LENGTH = 16;

/**
 * Lazily read ENCRYPTION_KEY so the module can be imported
 * even when the env-var isn't set (hashPin / verifyPin don't need it).
 *
 * Expected format: 64-char hex string representing 32 bytes.
 * Falls back to raw UTF-8 slice for backward compatibility.
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required. " +
      "Set a 64-char hex string (32 bytes) via Firebase Functions config or .env."
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  return Buffer.from(key.slice(0, 32));
}

export async function hashPin(pin: string): Promise<string> {
  return await bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(pin, hash);
}

/**
 * Encrypt with AES-256-GCM. Output: `v2:<nonce>:<authTag>:<ciphertext>` (hex).
 */
export function encrypt(text: string): string {
  const keyBuf = getEncryptionKey();
  const nonce = crypto.randomBytes(GCM_NONCE_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, nonce);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();
  return `v2:${nonce.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt data. Supports both `v2:` (GCM) and legacy `iv:ciphertext` (CBC).
 */
export function decrypt(text: string): string {
  if (text.startsWith("v2:")) {
    const parts = text.slice(3).split(":");
    if (parts.length !== 3) throw new Error("Malformed v2 ciphertext");
    const nonce = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const ciphertext = parts[2];

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      nonce
    );
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // Legacy CBC path (pre-migration ciphertexts)
  const parts = text.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encryptedText = parts[1];

  const keyBuf = getEncryptionKey();
  const legacyKey = keyBuf.length > 32 ? keyBuf.slice(0, 32) : keyBuf;
  const decipher = crypto.createDecipheriv("aes-256-cbc", legacyKey, iv);

  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Generate a secure random ID
 */
export function generateSecureId(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Generate QR code data with encryption
 */
export function generateQRData(
  qrCodeId: string,
  merchantId: string,
  amount: number,
  expiresAt: Date
): string {
  const data = JSON.stringify({
    id: qrCodeId,
    merchantId,
    amount,
    expiresAt: expiresAt.toISOString(),
    nonce: generateSecureId(16),
  });

  return encrypt(data);
}

/**
 * Parse and validate QR code data
 */
export function parseQRData(encryptedData: string): {
  id: string;
  merchantId: string;
  amount: number;
  expiresAt: Date;
  nonce: string;
} | null {
  try {
    const decrypted = decrypt(encryptedData);
    const parsed = JSON.parse(decrypted);

    return {
      id: parsed.id,
      merchantId: parsed.merchantId,
      amount: parsed.amount,
      expiresAt: new Date(parsed.expiresAt),
      nonce: parsed.nonce,
    };
  } catch (error) {
    console.error("Failed to parse QR data:", error);
    return null;
  }
}

/**
 * Verify webhook signature (for Stripe, Zaad, eDahab)
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const computedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature)
  );
}
