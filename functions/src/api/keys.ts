/**
 * Merchant API keys: minting, hashing and request authentication.
 *
 * A key is `zpk_live_` or `zpk_test_` followed by 32 characters of base64url
 * (192 bits). The prefix is the mode: a test key reaches the same API, but
 * everything it makes is `livemode: false`, kept apart from live data, and
 * never moves money (see docs/MERCHANT_API.md, "Test mode"). Only
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
import { API_KEYS_COLLECTION, MerchantApiKey, isLiveObject } from "./types";

export type ApiMode = "live" | "test";

export const API_KEY_PREFIXES: Record<ApiMode, string> = {
  live: "zpk_live_",
  test: "zpk_test_",
};
const API_KEY_PATTERN = /^zpk_(live|test)_[A-Za-z0-9_-]{32}$/;

/** Don't write lastUsedAt on every request — once in this long is plenty. */
const LAST_USED_WRITE_INTERVAL_MS = 10 * 60 * 1000;

export function generateApiKey(mode: ApiMode = "live"): string {
  return API_KEY_PREFIXES[mode] + crypto.randomBytes(24).toString("base64url");
}

export function apiKeyMode(key: string): ApiMode {
  return key.startsWith(API_KEY_PREFIXES.test) ? "test" : "live";
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

export function apiKeyHint(key: string): string {
  return `${key.slice(0, API_KEY_PREFIXES.live.length + 4)}…${key.slice(-4)}`;
}

export function isMerchantAccount(user: Pick<User, "accountType"> | undefined): boolean {
  return user?.accountType === "merchant" || user?.accountType === "agent_merchant";
}

/** A key's document ID: the SHA-256 of the key, in hex. */
export const KEY_ID_PATTERN = /^[0-9a-f]{64}$/;

/** Per mode. A merchant rotating keys needs two at once; more than a few is a smell. */
export const MAX_ACTIVE_KEYS_PER_MODE = 5;

/** A key as the console and the merchant app list it. Never carries the key. */
export interface ApiKeyRow {
  keyId: string;
  label: string;
  hint: string;
  mode: ApiMode;
  revoked: boolean;
  createdAt: string;
  createdVia: "console" | "merchant_app";
  lastUsedAt?: string;
  revokedAt?: string;
}

export function toApiKeyRow(keyId: string, key: MerchantApiKey): ApiKeyRow {
  return {
    keyId,
    label: key.label,
    hint: key.hint,
    mode: isLiveObject(key) ? "live" : "test",
    revoked: key.revoked,
    createdAt: key.createdAt.toDate().toISOString(),
    createdVia: key.createdVia ?? "console",
    ...(key.lastUsedAt ? { lastUsedAt: key.lastUsedAt.toDate().toISOString() } : {}),
    ...(key.revokedAt ? { revokedAt: key.revokedAt.toDate().toISOString() } : {}),
  };
}

/** A merchant's keys, newest first. */
export async function listKeysFor(merchantId: string): Promise<ApiKeyRow[]> {
  const snap = await admin
    .firestore()
    .collection(API_KEYS_COLLECTION)
    .where("merchantId", "==", merchantId)
    .get();
  return snap.docs
    .map((d) => toApiKeyRow(d.id, d.data() as MerchantApiKey))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * How many unrevoked keys a merchant holds in one mode. Counted in memory:
 * keys from before test mode have no `livemode` field for a query to match.
 */
export async function activeKeyCount(merchantId: string, mode: ApiMode): Promise<number> {
  const snap = await admin
    .firestore()
    .collection(API_KEYS_COLLECTION)
    .where("merchantId", "==", merchantId)
    .where("revoked", "==", false)
    .get();
  return snap.docs.filter((d) => isLiveObject(d.data() as MerchantApiKey) === (mode === "live")).length;
}

/**
 * Mint a key and the record that stores its hash. The caller writes the
 * record (in its own transaction, beside its audit trail) and hands the key
 * over exactly once.
 */
export function mintApiKey(input: {
  merchantId: string;
  label: string;
  mode: ApiMode;
  createdBy: string;
  createdVia: "console" | "merchant_app";
}): { apiKey: string; keyId: string; record: MerchantApiKey } {
  const apiKey = generateApiKey(input.mode);
  return {
    apiKey,
    keyId: hashApiKey(apiKey),
    record: {
      merchantId: input.merchantId,
      label: input.label,
      hint: apiKeyHint(apiKey),
      livemode: input.mode === "live",
      revoked: false,
      createdAt: admin.firestore.Timestamp.now(),
      createdBy: input.createdBy,
      createdVia: input.createdVia,
    },
  };
}

export interface ApiCaller {
  keyId: string;
  merchantId: string;
  merchant: User;
  /** False for a `zpk_test_` key: nothing this caller does moves money. */
  livemode: boolean;
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
      "Send your API key as 'Authorization: Bearer zpk_live_…' (or zpk_test_… in test mode)"
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
  // The prefix and the stored mode are set together at issue; a mismatch means
  // the record was written some other way, and the key is not trusted.
  const livemode = apiKeyMode(key) === "live";
  if (isLiveObject(apiKey) !== livemode) throw invalidKey();

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

  return { keyId, merchantId: apiKey.merchantId, merchant: merchant as User, livemode };
}
