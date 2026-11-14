/**
 * Merchant API keys — issued and revoked from the console.
 *
 * A key lets a merchant's server raise charges and refund them, so it is
 * issued the way other merchant powers are: by an ops admin, with a reason,
 * audited in the same transaction. The key itself is returned exactly once;
 * only its hash is stored (see api/keys.ts), so a lost key is revoked and
 * replaced, never recovered.
 *
 * The console issues live keys, and test keys for partners. Only the console
 * can give a key the `transfers` scope, and only for a merchant that is a
 * partner (api/partners.ts). Merchants can also make their own keys, live and
 * test, from the merchant app (merchants/apiKeys.ts), never with a scope; the
 * console still lists and revokes every key, whoever made it.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { ApiResponse, User } from "../types";
import { isAccountActive } from "../utils/accountStatus";
import {
  ApiKeyRow,
  KEY_ID_PATTERN,
  MAX_ACTIVE_KEYS_PER_MODE,
  activeKeyCount,
  isMerchantAccount,
  listKeysFor,
  mintApiKey,
  toApiKeyRow,
} from "../api/keys";
import { API_KEYS_COLLECTION, ApiKeyScope, MerchantApiKey } from "../api/types";
import { getPartner } from "../api/partners";

export type { ApiKeyRow };

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

    return { success: true, data: { keys: await listKeysFor(merchantId) } };
  }
);

interface IssueApiKeyInput {
  merchantId: string;
  label: string;
  reason: string;
  /** Default live. */
  mode?: "live" | "test";
  /** Give the key the transfers scope. Partners only. */
  transfers?: boolean;
  /** Give the key the agreements scope. Partners with linked payments on only. */
  agreements?: boolean;
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

    const mode = request.data?.mode === "test" ? "test" : "live";
    const scopes: ApiKeyScope[] = [];
    if (request.data?.transfers === true) scopes.push("transfers");
    if (request.data?.agreements === true) scopes.push("agreements");
    const partner = scopes.length ? await getPartner(merchantId) : undefined;
    if (scopes.includes("transfers") && !partner?.transfersEnabled) {
      throw new https.HttpsError(
        "failed-precondition",
        "Only a partner's keys can make transfers. Turn on transfers for this merchant first."
      );
    }
    if (scopes.includes("agreements") && !partner?.agreementsEnabled) {
      throw new https.HttpsError(
        "failed-precondition",
        "Only a partner's keys can use agreements. Turn on linked payments for this merchant first."
      );
    }

    if ((await activeKeyCount(merchantId, mode)) >= MAX_ACTIVE_KEYS_PER_MODE) {
      throw new https.HttpsError(
        "failed-precondition",
        `This merchant already has ${MAX_ACTIVE_KEYS_PER_MODE} active ${mode} keys. Revoke one first.`
      );
    }

    const { apiKey, keyId, record } = mintApiKey({
      merchantId,
      label,
      mode,
      scopes,
      createdBy: actor.uid,
      createdVia: "console",
    });

    await db.runTransaction(async (tx) => {
      tx.create(db.collection(API_KEYS_COLLECTION).doc(keyId), record);
      stageAuditEntry(tx, {
        actor,
        action: "api_key.issue",
        target: { type: "api_key", id: keyId },
        reason,
        after: { merchantId, label, hint: record.hint, mode, scopes },
      });
    });

    return { success: true, data: { ...toApiKeyRow(keyId, record), apiKey } };
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
      if (key.revoked) return toApiKeyRow(keyId, key);

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
      return toApiKeyRow(keyId, { ...key, revoked: true, revokedAt: now });
    });

    return { success: true, data: row };
  }
);
