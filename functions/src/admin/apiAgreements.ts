/**
 * Agreements (api/agreements.ts) from the console: see a merchant's, end one.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { ApiResponse } from "../types";
import { AGREEMENT_ID_PATTERN, effectiveAgreementStatus } from "../api/agreements";
import { API_AGREEMENTS_COLLECTION, ApiAgreement } from "../api/types";

export interface ApiAgreementRow {
  id: string;
  /** Last four digits only. */
  customerPhone: string;
  status: string;
  deviceLabel: string | null;
  maxChargeUsdCents: number | null;
  dailyUsdCents: number | null;
  livemode: boolean;
  createdAt: string | null;
  approvedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

export function maskPhone(phone: string): string {
  return phone.length > 4 ? `•••• ${phone.slice(-4)}` : "••••";
}

function toRow(id: string, a: ApiAgreement): ApiAgreementRow {
  return {
    id,
    customerPhone: maskPhone(a.customerPhone),
    status: effectiveAgreementStatus(a),
    deviceLabel: a.deviceLabel ?? null,
    maxChargeUsdCents: a.maxChargeUsdCents ?? null,
    dailyUsdCents: a.dailyUsdCents ?? null,
    livemode: a.livemode,
    createdAt: a.createdAt ? a.createdAt.toDate().toISOString() : null,
    approvedAt: a.approvedAt ? a.approvedAt.toDate().toISOString() : null,
    revokedAt: a.revokedAt ? a.revokedAt.toDate().toISOString() : null,
    revokedBy: a.revokedBy ?? null,
  };
}

/** A merchant's agreements, newest first, at most 200. */
export const adminListAgreements = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ merchantId: string }>): Promise<ApiResponse<ApiAgreementRow[]>> => {
    requireAdmin(request, ["ops", "super"]);
    const merchantId = request.data?.merchantId;
    if (typeof merchantId !== "string" || !merchantId) {
      throw new https.HttpsError("invalid-argument", "merchantId is required");
    }
    const snap = await admin
      .firestore()
      .collection(API_AGREEMENTS_COLLECTION)
      .where("merchantId", "==", merchantId)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    return { success: true, data: snap.docs.map((d) => toRow(d.id, d.data() as ApiAgreement)) };
  }
);

export const adminRevokeAgreement = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ agreementId: string; reason: string }>): Promise<ApiResponse<ApiAgreementRow>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const id = request.data?.agreementId;
    if (typeof id !== "string" || !AGREEMENT_ID_PATTERN.test(id)) {
      throw new https.HttpsError("invalid-argument", "agreementId is required");
    }
    const db = admin.firestore();
    const ref = db.collection(API_AGREEMENTS_COLLECTION).doc(id);
    const row = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new https.HttpsError("not-found", "Agreement not found");
      const a = snap.data() as ApiAgreement;
      const status = effectiveAgreementStatus(a);
      if (status === "revoked" || status === "expired") return toRow(id, a);
      const update = { status: "revoked" as const, revokedAt: admin.firestore.Timestamp.now(), revokedBy: "ops" as const };
      tx.update(ref, update);
      stageAuditEntry(tx, {
        actor,
        action: "api_agreement.revoke",
        target: { type: "user", id: a.merchantId },
        reason,
        before: { agreementId: id, status },
        after: { agreementId: id, status: "revoked" },
      });
      return toRow(id, { ...a, ...update });
    });
    return { success: true, data: row };
  }
);
