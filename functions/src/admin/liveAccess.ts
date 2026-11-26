/**
 * Console: shops asking for live API access (api/liveAccess.ts).
 *
 * Approving lets the shop's owner make live keys in the merchant app, with
 * their PIN, up to MAX_ACTIVE_KEYS_PER_MODE. Declining tells the shop why;
 * it may ask again. Withdrawing ends access and revokes every live key the
 * shop holds, in the same transaction. Each decision is audited beside it.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { ApiResponse, User } from "../types";
import { notifyUser } from "../utils/notifications";
import { isMerchantAccount } from "../api/keys";
import { API_KEYS_COLLECTION, MerchantApiKey, isLiveObject } from "../api/types";
import {
  API_LIVE_ACCESS,
  LiveAccessDoc,
  LiveAccessView,
  NOTE_MAX,
  cleanText,
  liveAccessRef,
  toLiveAccessView,
} from "../api/liveAccess";

export interface LiveAccessRequestRow extends LiveAccessView {
  merchantId: string;
  businessName: string | null;
  phoneNumber: string | null;
  accountType: string | null;
  accountStatus: string | null;
  /** Unrevoked test keys: a sign the shop has started building. */
  activeTestKeys: number;
}

/** Waiting requests, oldest first. Few by nature, so sorted in memory (no index). */
export const adminListLiveAccessRequests = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<void>): Promise<ApiResponse<{ requests: LiveAccessRequestRow[] }>> => {
    requireAdmin(request, ["ops", "super"]);
    const db = admin.firestore();
    const snap = await db.collection(API_LIVE_ACCESS).where("status", "==", "pending").limit(200).get();
    const docs = snap.docs.map((d) => d.data() as LiveAccessDoc);

    const requests = await Promise.all(
      docs.map(async (doc): Promise<LiveAccessRequestRow> => {
        const [userSnap, keysSnap] = await Promise.all([
          db.collection("users").doc(doc.merchantId).get(),
          db.collection(API_KEYS_COLLECTION)
            .where("merchantId", "==", doc.merchantId)
            .where("revoked", "==", false)
            .get(),
        ]);
        const user = userSnap.data() as (User & { businessName?: string }) | undefined;
        return {
          ...toLiveAccessView(doc),
          merchantId: doc.merchantId,
          businessName: user?.businessName ?? null,
          phoneNumber: user?.phoneNumber ?? null,
          accountType: user?.accountType ?? null,
          accountStatus: (user as { accountStatus?: string } | undefined)?.accountStatus ?? null,
          activeTestKeys: keysSnap.docs.filter((d) => !isLiveObject(d.data() as MerchantApiKey)).length,
        };
      })
    );
    requests.sort((a, b) => (a.requestedAt ?? "").localeCompare(b.requestedAt ?? ""));
    return { success: true, data: { requests } };
  }
);

interface DecideInput {
  merchantId: string;
  decision: "approve" | "decline";
  /** Why, for the audit log. */
  reason: string;
  /** For the shop, when declining. */
  note?: string;
}

export const adminDecideLiveAccess = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<DecideInput>): Promise<ApiResponse<LiveAccessView>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const merchantId = request.data?.merchantId;
    const decision = request.data?.decision;
    if (typeof merchantId !== "string" || !merchantId) {
      throw new https.HttpsError("invalid-argument", "merchantId is required");
    }
    if (decision !== "approve" && decision !== "decline") {
      throw new https.HttpsError("invalid-argument", "decision must be approve or decline");
    }
    const note = cleanText(request.data?.note).slice(0, NOTE_MAX) || null;

    const db = admin.firestore();
    const ref = liveAccessRef(merchantId);
    const view = await db.runTransaction(async (tx) => {
      const [snap, userSnap] = await Promise.all([tx.get(ref), tx.get(db.collection("users").doc(merchantId))]);
      const doc = snap.data() as LiveAccessDoc | undefined;
      if (!doc || doc.status !== "pending") {
        throw new https.HttpsError("failed-precondition", "This request isn't waiting for a decision any more.");
      }
      if (decision === "approve" && !isMerchantAccount(userSnap.data() as User | undefined)) {
        throw new https.HttpsError("failed-precondition", "API keys are for merchant accounts.");
      }
      const now = admin.firestore.Timestamp.now();
      const status = decision === "approve" ? "approved" : "declined";
      const update = { status, decidedAt: now, decidedBy: actor.uid, note: decision === "decline" ? note : null };
      tx.update(ref, update);
      stageAuditEntry(tx, {
        actor,
        action: `api_live_access.${decision}`,
        target: { type: "api_live_access", id: merchantId },
        reason,
        before: { status: doc.status },
        after: { status, ...(update.note ? { note: update.note } : {}) },
      });
      return toLiveAccessView({ ...doc, ...update } as LiveAccessDoc);
    });

    notifyUser(
      merchantId,
      "api_access",
      { key: decision === "approve" ? "api.live_approved" : "api.live_declined" },
      { type: "api_access" }
    ).catch((err) => console.error("Live access push failed:", err));
    return { success: true, data: view };
  }
);

/** End a shop's live access and revoke its live keys, at once. */
export const adminWithdrawLiveAccess = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ merchantId: string; reason: string; note?: string }>
  ): Promise<ApiResponse<LiveAccessView & { revokedKeys: number }>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const merchantId = request.data?.merchantId;
    if (typeof merchantId !== "string" || !merchantId) {
      throw new https.HttpsError("invalid-argument", "merchantId is required");
    }
    const note = cleanText(request.data?.note).slice(0, NOTE_MAX) || null;

    const db = admin.firestore();
    const ref = liveAccessRef(merchantId);
    const keysQuery = db.collection(API_KEYS_COLLECTION)
      .where("merchantId", "==", merchantId)
      .where("revoked", "==", false);

    const result = await db.runTransaction(async (tx) => {
      const [snap, keysSnap] = await Promise.all([tx.get(ref), tx.get(keysQuery)]);
      const doc = snap.data() as LiveAccessDoc | undefined;
      const liveKeys = keysSnap.docs.filter((d) => isLiveObject(d.data() as MerchantApiKey));
      // A legacy shop has no doc but does hold live keys.
      if (doc?.status !== "approved" && liveKeys.length === 0) {
        throw new https.HttpsError("failed-precondition", "This shop doesn't have live access.");
      }
      const now = admin.firestore.Timestamp.now();
      const next: LiveAccessDoc = {
        merchantId,
        purpose: doc?.purpose ?? "",
        requestedAt: doc?.requestedAt ?? now,
        status: "withdrawn",
        decidedAt: now,
        decidedBy: actor.uid,
        note,
      };
      tx.set(ref, next);
      for (const k of liveKeys) {
        tx.update(k.ref, { revoked: true, revokedAt: now, revokedBy: actor.uid });
      }
      stageAuditEntry(tx, {
        actor,
        action: "api_live_access.withdraw",
        target: { type: "api_live_access", id: merchantId },
        reason,
        before: { status: doc?.status ?? "approved (legacy)" },
        after: { status: "withdrawn", revokedKeys: liveKeys.map((k) => (k.data() as MerchantApiKey).hint) },
      });
      return { view: toLiveAccessView(next), revokedKeys: liveKeys.length };
    });

    notifyUser(merchantId, "api_access", { key: "api.live_withdrawn" }, { type: "api_access" })
      .catch((err) => console.error("Live access push failed:", err));
    return { success: true, data: { ...result.view, revokedKeys: result.revokedKeys } };
  }
);
