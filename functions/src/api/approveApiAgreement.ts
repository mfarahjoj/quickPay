/**
 * Customer side of an agreement (agreements.ts): look it up, approve it with
 * the PIN, list the ones in force, switch one off.
 *
 * Approving is the only step that needs the PIN. It binds the phone key the
 * partner sent to this customer, with the partner's caps as they are now, so
 * raising a partner's caps later never raises what a customer agreed to.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { requireActiveAccount } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { ApiResponse } from "../types";
import { ApiCaller } from "./keys";
import { conflict, notFound } from "./http";
import { agreementCapsOf, getPartner } from "./partners";
import {
  AGREEMENT_ID_PATTERN,
  agreementLapsed,
  effectiveAgreementStatus,
  revokeAgreementById,
} from "./agreements";
import { API_AGREEMENTS_COLLECTION, ApiAgreement, ApiAgreementStatus } from "./types";

function requireAgreementId(id: unknown): string {
  if (typeof id !== "string" || !AGREEMENT_ID_PATTERN.test(id)) {
    throw new https.HttpsError("invalid-argument", "A valid agreement ID is required");
  }
  return id;
}

async function phoneOf(uid: string): Promise<string | undefined> {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  return snap.data()?.phoneNumber as string | undefined;
}

/** Only the customer the partner addressed may see or approve it; a test agreement nobody may. */
function assertForCustomer(a: ApiAgreement, uid: string, phone: string | undefined): void {
  if (!a.livemode) {
    throw new https.HttpsError("failed-precondition", "This is a test request from a developer. It can't be approved in Zapp Pay.");
  }
  if (a.merchantId === uid) throw new https.HttpsError("permission-denied", "You can't link your own business");
  if (a.customerId ? a.customerId !== uid : a.customerPhone !== phone) {
    throw new https.HttpsError("permission-denied", "This request is for a different customer");
  }
}

interface AgreementView {
  agreementId: string;
  merchantName: string;
  status: ApiAgreementStatus;
  deviceLabel: string | null;
  /** US cents. While pending, the caps approving now would give. */
  maxChargeUsdCents: number;
  dailyUsdCents: number;
  expiresAt: string | null;
  approvedAt: string | null;
}

function view(id: string, a: ApiAgreement, caps: { maxChargeUsdCents: number; dailyUsdCents: number }): AgreementView {
  return {
    agreementId: id,
    merchantName: a.merchantName,
    status: effectiveAgreementStatus(a),
    deviceLabel: a.deviceLabel ?? null,
    maxChargeUsdCents: a.maxChargeUsdCents ?? caps.maxChargeUsdCents,
    dailyUsdCents: a.dailyUsdCents ?? caps.dailyUsdCents,
    expiresAt: a.status === "pending" ? a.expiresAt.toDate().toISOString() : null,
    approvedAt: a.approvedAt ? a.approvedAt.toDate().toISOString() : null,
  };
}

/** What the approval screen shows before the PIN. */
export const getApiAgreement = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ agreementId: string }>): Promise<ApiResponse<AgreementView>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const id = requireAgreementId(request.data?.agreementId);
    const snap = await admin.firestore().collection(API_AGREEMENTS_COLLECTION).doc(id).get();
    if (!snap.exists) throw new https.HttpsError("not-found", "Request not found");
    const a = snap.data() as ApiAgreement;
    assertForCustomer(a, uid, await phoneOf(uid));
    const partner = await getPartner(a.merchantId);
    return { success: true, data: view(id, a, partner ? agreementCapsOf(partner) : { maxChargeUsdCents: 0, dailyUsdCents: 0 }) };
  }
);

interface ApproveInput {
  agreementId: string;
  pin: string;
  /** The caps the customer was shown, in US cents. Refused if they changed since. */
  expectedMaxChargeUsdCents: number;
  expectedDailyUsdCents: number;
}

export const approveApiAgreement = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<ApproveInput>): Promise<ApiResponse<AgreementView>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const id = requireAgreementId(request.data?.agreementId);
    const { pin, expectedMaxChargeUsdCents, expectedDailyUsdCents } = request.data ?? ({} as ApproveInput);
    if (!pin) throw new https.HttpsError("invalid-argument", "PIN is required");
    if (!Number.isInteger(expectedMaxChargeUsdCents) || !Number.isInteger(expectedDailyUsdCents)) {
      throw new https.HttpsError("invalid-argument", "The limits you were shown are required");
    }
    if (!(await verifyUserPin(uid, pin))) throw new https.HttpsError("permission-denied", "Invalid PIN");
    await requireActiveAccount(uid);
    const phone = await phoneOf(uid);

    const db = admin.firestore();
    const ref = db.collection(API_AGREEMENTS_COLLECTION).doc(id);
    type Outcome = { approved: AgreementView } | { lapsed: true };
    const outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new https.HttpsError("not-found", "Request not found");
      const a = snap.data() as ApiAgreement;
      assertForCustomer(a, uid, phone);
      // A retry after the reply was lost.
      if (a.status === "active" && a.customerId === uid) return { approved: view(id, a, { maxChargeUsdCents: 0, dailyUsdCents: 0 }) };
      const now = admin.firestore.Timestamp.now();
      if (agreementLapsed(a, now.toMillis())) {
        // Record it, then refuse once committed: throwing here would roll it back.
        tx.update(ref, { status: "expired" });
        return { lapsed: true };
      }
      if (a.status !== "pending") {
        throw new https.HttpsError("failed-precondition", `This request is already ${a.status}`);
      }
      const partner = (await tx.get(db.collection("api_partners").doc(a.merchantId))).data();
      if (!partner?.agreementsEnabled) {
        throw new https.HttpsError("failed-precondition", `${a.merchantName} can't take payments this way any more`);
      }
      const caps = agreementCapsOf(partner as any);
      if (caps.maxChargeUsdCents !== expectedMaxChargeUsdCents || caps.dailyUsdCents !== expectedDailyUsdCents) {
        throw new https.HttpsError("failed-precondition", "The limits changed. Open the request again.");
      }
      // One agreement per customer, partner and mode: a new link replaces the old.
      const others = await tx.get(
        db
          .collection(API_AGREEMENTS_COLLECTION)
          .where("merchantId", "==", a.merchantId)
          .where("customerId", "==", uid)
          .where("livemode", "==", a.livemode)
          .where("status", "==", "active")
      );
      for (const d of others.docs) {
        if (d.id !== id) tx.update(d.ref, { status: "revoked", revokedAt: now, revokedBy: "replaced" });
      }
      const update = { status: "active" as const, customerId: uid, approvedAt: now, ...caps };
      tx.update(ref, update);
      return { approved: view(id, { ...a, ...update }, caps) };
    });

    if ("lapsed" in outcome) throw new https.HttpsError("failed-precondition", "This request has expired. Start again in the app.");
    console.log(JSON.stringify({ agreementApproved: id, customerId: uid }));
    return { success: true, data: outcome.approved };
  }
);

/** The customer's agreements in force. */
export const listMyAgreements = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<unknown>): Promise<ApiResponse<AgreementView[]>> => {
    requireAuth(request);
    const snap = await admin
      .firestore()
      .collection(API_AGREEMENTS_COLLECTION)
      .where("customerId", "==", request.auth!.uid)
      .where("status", "==", "active")
      .get();
    const rows = snap.docs
      .map((d) => view(d.id, d.data() as ApiAgreement, { maxChargeUsdCents: 0, dailyUsdCents: 0 }))
      .sort((x, y) => (y.approvedAt ?? "").localeCompare(x.approvedAt ?? ""));
    return { success: true, data: rows };
  }
);

/** Switch one off. No PIN: taking a permission away should always be easy. */
export const revokeMyAgreement = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ agreementId: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const id = requireAgreementId(request.data?.agreementId);
    await revokeAgreementById(id, "customer", (a) => {
      if (a.customerId !== uid) throw new https.HttpsError("not-found", "Not found");
    }).catch((e) => {
      if (e instanceof https.HttpsError) throw e;
      if (e?.code === "resource_missing") throw new https.HttpsError("not-found", "Not found");
      throw e;
    });
    return { success: true };
  }
);

/** Test mode: approve a test agreement as if a customer had, with the partner's caps. */
export async function approveTestAgreement(caller: ApiCaller, id: string): Promise<ApiAgreement> {
  if (!AGREEMENT_ID_PATTERN.test(id)) throw notFound("agreement");
  const db = admin.firestore();
  const ref = db.collection(API_AGREEMENTS_COLLECTION).doc(id);
  const partner = await getPartner(caller.merchantId);
  return db.runTransaction(async (tx) => {
    const a = (await tx.get(ref)).data() as ApiAgreement | undefined;
    if (!a || a.merchantId !== caller.merchantId || a.livemode) throw notFound("agreement");
    if (a.status === "active") return a;
    if (effectiveAgreementStatus(a) !== "pending") throw conflict("agreement_not_pending", `This agreement is ${effectiveAgreementStatus(a)}`);
    const update = { status: "active" as const, approvedAt: admin.firestore.Timestamp.now(), ...agreementCapsOf(partner!) };
    tx.update(ref, update);
    return { ...a, ...update };
  });
}
