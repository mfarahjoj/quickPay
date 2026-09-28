/**
 * Merchant API keys: minting, hashing and request authentication.
 *
 * A key is `zpk_live_` followed by 32 characters of base64url (192 bits). Only
 * its SHA-256 is stored, as the document ID, so authenticating costs one read
 * and the collection never holds a usable secret. A fast hash is right here —
 * unlike a 6-digit PIN, a 192-bit random key cannot be brute-forced from its
 * hash, so bcrypt's cost would buy nothing but latency on every request.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import type { Request } from "firebase-functions/v2/https";
import { User } from "../types";
import { isAccountActive } from "../utils/accountStatus";
import { ApiError, header } from "./http";
import { API_KEYS_COLLECTION, MerchantApiKey } from "./types";

export const API_KEY_PREFIX = "zpk_live_";
const API_KEY_PATTERN = /^zpk_live_[A-Za-z0-9_-]{32}$/;

/** Don't write lastUsedAt on every request — once in this long is plenty. */
const LAST_USED_WRITE_INTERVAL_MS = 10 * 60 * 1000;

export function generateApiKey(): string {
  return API_KEY_PREFIX + crypto.randomBytes(24).toString("base64url");
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

export function apiKeyHint(key: string): string {
  return `${key.slice(0, API_KEY_PREFIX.length + 4)}…${key.slice(-4)}`;
}

export function isMerchantAccount(user: Pick<User, "accountType"> | undefined): boolean {
  return user?.accountType === "merchant" || user?.accountType === "agent_merchant";
}

export interface ApiCaller {
  keyId: string;
  merchantId: string;
  merchant: User;
}

const invalidKey = () =>
  new ApiError(401, "authentication_error", "invalid_api_key", "Invalid API key provided");

/**
 * Resolve `Authorization: Bearer zpk_live_…` to an active merchant.
 *
 * Every failure before the merchant check reads the same, so the API does not
 * tell a caller whether a key was malformed, unknown or revoked.
 */
export async function authenticateApiKey(req: Request): Promise<ApiCaller> {
  const auth = header(req, "authorization");
  const match = auth ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
  if (!match) {
    throw new ApiError(
      401,
      "authentication_error",
      "missing_api_key",
      "Send your API key as 'Authorization: Bearer zpk_live_…'"
    );
  }
  const key = match[1];
  if (!API_KEY_PATTERN.test(key)) throw invalidKey();

  const db = admin.firestore();
  const keyId = hashApiKey(key);
  const keyRef = db.collection(API_KEYS_COLLECTION).doc(keyId);
  const keySnap = await keyRef.get();
  if (!keySnap.exists) throw invalidKey();
  const apiKey = keySnap.data() as MerchantApiKey;
  if (apiKey.revoked) throw invalidKey();

  const merchantSnap = await db.collection("users").doc(apiKey.merchantId).get();
  const merchant = merchantSnap.data() as User | undefined;

  // Roles can be withdrawn after a key is issued; the key must not outlive them.
  if (!merchantSnap.exists || !isMerchantAccount(merchant)) {
    throw new ApiError(
      403,
      "permission_error",
      "not_a_merchant",
      "This key's account is no longer a merchant account"
    );
  }
  if (!isAccountActive(merchant)) {
    throw new ApiError(
      403,
      "permission_error",
      "account_inactive",
      "This merchant account is not active. Contact Zapp support."
    );
  }

  const lastUsed = apiKey.lastUsedAt?.toMillis() ?? 0;
  if (Date.now() - lastUsed > LAST_USED_WRITE_INTERVAL_MS) {
    keyRef
      .update({ lastUsedAt: admin.firestore.Timestamp.now() })
      .catch((err) => console.error("Failed to record API key use:", err));
  }

  return { keyId, merchantId: apiKey.merchantId, merchant: merchant as User };
}
