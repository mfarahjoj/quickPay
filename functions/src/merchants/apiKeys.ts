/**
 * Merchants making and revoking their own API keys, from the merchant app.
 *
 * Until now every key went through Zapp ops (admin/apiKeys.ts), which is fine
 * for the first few partners and does not scale. The merchant role itself is
 * still granted by an admin, so self-serve keys add no new trust: a key only
 * acts for the merchant who holds it.
 *
 * - Test keys (`zpk_test_`) never move money; making one needs no PIN, so a
 *   developer can start building the moment the merchant opens the screen.
 * - Live keys can refund from the wallet, so making one needs the merchant's
 *   PIN, exactly like a payout.
 * - Revoking only ever takes power away; it needs nothing beyond sign-in, so a
 *   merchant who suspects a leak can kill a key instantly.
 *
 * Ops can still list and revoke any key from the console.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { requireActiveAccount } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { ApiResponse, User } from "../types";
import {
  ApiKeyRow,
  ApiMode,
  KEY_ID_PATTERN,
  MAX_ACTIVE_KEYS_PER_MODE,
  activeKeyCount,
  isMerchantAccount,
  listKeysFor,
  mintApiKey,
  toApiKeyRow,
} from "../api/keys";
import { API_KEYS_COLLECTION, MerchantApiKey } from "../api/types";

function requireMerchant(user: FirebaseFirestore.DocumentData): void {
  if (!isMerchantAccount(user as User)) {
    throw new https.HttpsError("permission-denied", "API keys are for merchant accounts");
  }
}

export const listMyApiKeys = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<void>): Promise<ApiResponse<{ keys: ApiKeyRow[] }>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;
    const snap = await admin.firestore().collection("users").doc(merchantId).get();
    requireMerchant(snap.data() ?? {});
    return { success: true, data: { keys: await listKeysFor(merchantId) } };
  }
);

interface CreateMyApiKeyInput {
  label: string;
  mode: ApiMode;
  /** Required for a live key. */
  pin?: string;
}

export const createMyApiKey = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<CreateMyApiKeyInput>
  ): Promise<ApiResponse<ApiKeyRow & { apiKey: string }>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;
    const { mode, pin } = request.data ?? ({} as CreateMyApiKeyInput);
    const label = typeof request.data?.label === "string" ? request.data.label.trim() : "";

    if (mode !== "live" && mode !== "test") {
      throw new https.HttpsError("invalid-argument", "mode must be live or test");
    }
    if (label.length < 1 || label.length > 60) {
      throw new https.HttpsError(
        "invalid-argument",
        "A label of 1-60 characters is required (e.g. \"Website\" or \"Till 2\")"
      );
    }
    if (mode === "live" && !pin) {
      throw new https.HttpsError("invalid-argument", "PIN is required");
    }

    const merchant = await requireActiveAccount(merchantId);
    requireMerchant(merchant);

    if (mode === "live") {
      const pinValid = await verifyUserPin(merchantId, pin as string);
      if (!pinValid) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }
    }

    if ((await activeKeyCount(merchantId, mode)) >= MAX_ACTIVE_KEYS_PER_MODE) {
      throw new https.HttpsError(
        "resource-exhausted",
        `You already have ${MAX_ACTIVE_KEYS_PER_MODE} active ${mode} keys. Revoke one first.`
      );
    }

    const { apiKey, keyId, record } = mintApiKey({
      merchantId,
      label,
      mode,
      createdBy: merchantId,
      createdVia: "merchant_app",
    });
    await admin.firestore().collection(API_KEYS_COLLECTION).doc(keyId).create(record);

    console.log(`Merchant ${merchantId} created a ${mode} API key ${record.hint}`);
    return { success: true, data: { ...toApiKeyRow(keyId, record), apiKey } };
  }
);

export const revokeMyApiKey = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ keyId: string }>): Promise<ApiResponse<ApiKeyRow>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;
    const keyId = request.data?.keyId;
    if (typeof keyId !== "string" || !KEY_ID_PATTERN.test(keyId)) {
      throw new https.HttpsError("invalid-argument", "A valid keyId is required");
    }

    const db = admin.firestore();
    const ref = db.collection(API_KEYS_COLLECTION).doc(keyId);
    const row = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const key = snap.data() as MerchantApiKey | undefined;
      // Someone else's key reads the same as no key.
      if (!key || key.merchantId !== merchantId) {
        throw new https.HttpsError("not-found", "API key not found");
      }
      if (key.revoked) return toApiKeyRow(keyId, key);
      const now = admin.firestore.Timestamp.now();
      tx.update(ref, { revoked: true, revokedAt: now, revokedBy: merchantId });
      return toApiKeyRow(keyId, { ...key, revoked: true, revokedAt: now });
    });

    console.log(`Merchant ${merchantId} revoked API key ${row.hint}`);
    return { success: true, data: row };
  }
);
