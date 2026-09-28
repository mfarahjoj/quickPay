/**
 * Merchant API keys — issued and revoked from the console.
 *
 * A key lets a merchant's server raise charges and refund them, so it is
 * issued the way other merchant powers are: by an ops admin, with a reason,
 * audited in the same transaction. The key itself is returned exactly once;
 * only its hash is stored (see api/keys.ts), so a lost key is revoked and
 * replaced, never recovered.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { ApiResponse, User } from "../types";
import { isAccountActive } from "../utils/accountStatus";
import { apiKeyHint, generateApiKey, hashApiKey, isMerchantAccount } from "../api/keys";
import { API_KEYS_COLLECTION, MerchantApiKey } from "../api/types";

/** A merchant rotating keys needs two live at once; more than a few is a smell. */
const MAX_ACTIVE_KEYS = 5;
const KEY_ID_PATTERN = /^[0-9a-f]{64}$/;

export interface ApiKeyRow {
  keyId: string;
  label: string;
  hint: string;
  revoked: boolean;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

function toRow(keyId: string, key: MerchantApiKey): ApiKeyRow {
  return {
    keyId,
    label: key.label,
    hint: key.hint,
    revoked: key.revoked,
    createdAt: key.createdAt.toDate().toISOString(),
    ...(key.lastUsedAt ? { lastUsedAt: key.lastUsedAt.toDate().toISOString() } : {}),
    ...(key.revokedAt ? { revokedAt: key.revokedAt.toDate().toISOString() } : {}),
  };
}

export const adminListApiKeys = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ merchantId: string }>
  ): Promise<ApiResponse<{ keys: ApiKeyRow[] }>> => {
    requireAdmin(request, ["ops", "super"]);
    const merchantId = request.data?.merchantId;
    if (typeof merchantId !== "string" || !merchantId) {
      throw new https.HttpsError("invalid-argument", "merchantId is required");
    }

    const snap = await admin
      .firestore()
      .collection(API_KEYS_COLLECTION)
      .where("merchantId", "==", merchantId)
      .get();

    const keys = snap.docs
      .map((d) => toRow(d.id, d.data() as MerchantApiKey))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { success: true, data: { keys } };
  }
);

interface IssueApiKeyInput {
  merchantId: string;
  label: string;
  reason: string;
}

export const adminIssueApiKey = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<IssueApiKeyInput>
  ): Promise<ApiResponse<ApiKeyRow & { apiKey: string }>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);

    const { merchantId } = request.data ?? ({} as IssueApiKeyInput);
    const label = typeof request.data?.label === "string" ? request.data.label.trim() : "";
    if (typeof merchantId !== "string" || !merchantId) {
      throw new https.HttpsError("invalid-argument", "merchantId is required");
    }
    if (label.length < 1 || label.length > 60) {
      throw new https.HttpsError(
        "invalid-argument",
        "A label of 1-60 characters is required (e.g. \"Website\" or \"Till 2\")"
      );
    }

    const db = admin.firestore();
    const merchantSnap = await db.collection("users").doc(merchantId).get();
    const merchant = merchantSnap.data() as User | undefined;
    if (!merchantSnap.exists) {
      throw new https.HttpsError("not-found", "User not found");
    }
    if (!isMerchantAccount(merchant)) {
      throw new https.HttpsError(
        "failed-precondition",
        "API keys are for merchant accounts. Approve the merchant role first."
      );
    }
    if (!isAccountActive(merchant)) {
      throw new https.HttpsError("failed-precondition", "This account is not active");
    }

    const active = await db
      .collection(API_KEYS_COLLECTION)
      .where("merchantId", "==", merchantId)
      .where("revoked", "==", false)
      .get();
    if (active.size >= MAX_ACTIVE_KEYS) {
      throw new https.HttpsError(
        "failed-precondition",
        `This merchant already has ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`
      );
    }

    const apiKey = generateApiKey();
    const keyId = hashApiKey(apiKey);
    const record: MerchantApiKey = {
      merchantId,
      label,
      hint: apiKeyHint(apiKey),
      revoked: false,
      createdAt: admin.firestore.Timestamp.now(),
      createdBy: actor.uid,
    };

    await db.runTransaction(async (tx) => {
      tx.create(db.collection(API_KEYS_COLLECTION).doc(keyId), record);
      stageAuditEntry(tx, {
        actor,
        action: "api_key.issue",
        target: { type: "api_key", id: keyId },
        reason,
        after: { merchantId, label, hint: record.hint },
      });
    });

    return { success: true, data: { ...toRow(keyId, record), apiKey } };
  }
);

export const adminRevokeApiKey = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ keyId: string; reason: string }>
  ): Promise<ApiResponse<ApiKeyRow>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const keyId = request.data?.keyId;
    if (typeof keyId !== "string" || !KEY_ID_PATTERN.test(keyId)) {
      throw new https.HttpsError("invalid-argument", "A valid keyId is required");
    }

    const db = admin.firestore();
    const ref = db.collection(API_KEYS_COLLECTION).doc(keyId);

    const row = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new https.HttpsError("not-found", "API key not found");
      }
      const key = snap.data() as MerchantApiKey;
      if (key.revoked) return toRow(keyId, key);

      const now = admin.firestore.Timestamp.now();
      tx.update(ref, { revoked: true, revokedAt: now, revokedBy: actor.uid });
      stageAuditEntry(tx, {
        actor,
        action: "api_key.revoke",
        target: { type: "api_key", id: keyId },
        reason,
        before: { revoked: false },
        after: { revoked: true, merchantId: key.merchantId, label: key.label },
      });
      return toRow(keyId, { ...key, revoked: true, revokedAt: now });
    });

    return { success: true, data: row };
  }
);
