/**
 * Customer side of an agreement (agreements.ts): look it up, approve it with
 * the PIN, list the ones in force, switch one off — and, at sign-up, find the
 * ones a partner left for this number before the person had Zapp.
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
import { firstCashInAt } from "./agreementFunding";
import { API_AGREEMENTS_COLLECTION, ApiAgreement, ApiAgreementRole, ApiAgreementStatus } from "./types";

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
  /** customer: the customer pays the partner; worker: the partner pays them. The approve screen's words follow it. */
  role: ApiAgreementRole;
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
    role: a.role ?? "customer",
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
    // Mid-sign-up there is no profile yet; the sign-in's verified number stands in.
    assertForCustomer(a, uid, (await phoneOf(uid)) ?? (request.auth!.token.phone_number as string | undefined));
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
    // Stamps a top-up from before the stamp existed, so the read below sees it.
    const toppedUpBefore = await firstCashInAt(uid).catch((err) => {
      console.error(`firstCashInAt(${uid}) failed:`, err);
      return null;
    });

    const db = admin.firestore();
    const ref = db.collection(API_AGREEMENTS_COLLECTION).doc(id);
    const userRef = db.collection("users").doc(uid);
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
      // One agreement per customer, partner, mode and role: a new link
      // replaces the old one of its kind, so a Ridy driver who also rides
      // keeps both.
      const role = a.role ?? "customer";
      const others = await tx.get(
        db
          .collection(API_AGREEMENTS_COLLECTION)
          .where("merchantId", "==", a.merchantId)
          .where("customerId", "==", uid)
          .where("livemode", "==", a.livemode)
          .where("status", "==", "active")
      );
      // Read in the transaction: a first top-up landing meanwhile either
      // shows here or finds this agreement active (agreementFunding.ts).
      const toppedUpAt = ((await tx.get(userRef)).data()?.firstCashInAt as FirebaseFirestore.Timestamp | undefined) ?? toppedUpBefore;
      for (const d of others.docs) {
        if (d.id === id || ((d.data() as ApiAgreement).role ?? "customer") !== role) continue;
        tx.update(d.ref, { status: "revoked", revokedAt: now, revokedBy: "replaced" });
      }
      const update = {
        status: "active" as const,
        customerId: uid,
        approvedAt: now,
        ...caps,
        ...(toppedUpAt ? { customerToppedUpAt: toppedUpAt } : {}),
      };
      tx.update(ref, update);
      return { approved: view(id, { ...a, ...update }, caps) };
    });

    if ("lapsed" in outcome) throw new https.HttpsError("failed-precondition", "This request has expired. Start again in the app.");
    console.log(JSON.stringify({ agreementApproved: id, customerId: uid }));
    return { success: true, data: outcome.approved };
  }
);

interface PendingAgreementView extends AgreementView {
  /** Left for this number before it had a Zapp account. */
  signup: boolean;
}

interface PendingAgreements {
  agreements: PendingAgreementView[];
  /**
   * What sign-up may fill in, from the newest sign-up agreement: the name the
   * partner has for this person, and their number as their Zaad when it is a
   * Telesom (063) number. Suggestions only: the person checks and can change both.
   */
  prefill: { fullName: string | null; zaadNumber: string | null };
}

/** At most this many pending agreements are offered at once. */
const MAX_PENDING = 5;

/** +252 63… is Telesom, whose mobile money is Zaad. Pure. */
export function zaadSuggestion(phone: string | undefined): string | null {
  return phone && /^\+25263[0-9]{7}$/.test(phone) ? phone : null;
}

/**
 * Pending agreements addressed to the caller's number, newest first: right
 * after sign-up, the requests a partner (Ridy) left before the person had
 * Zapp, so they can approve them without going back to the partner's app.
 * Works mid-sign-up, before the PIN, from the verified number on the
 * sign-in itself.
 */
export const getMyPendingAgreements = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<unknown>): Promise<ApiResponse<PendingAgreements>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const tokenPhone = request.auth!.token.phone_number as string | undefined;
    const phone = tokenPhone || (await phoneOf(uid));
    if (!phone) return { success: true, data: { agreements: [], prefill: { fullName: null, zaadNumber: null } } };
    const snap = await admin
      .firestore()
      .collection(API_AGREEMENTS_COLLECTION)
      .where("customerPhone", "==", phone)
      .where("livemode", "==", true)
      .where("status", "==", "pending")
      .get();
    const now = Date.now();
    const open = snap.docs
      .map((d) => ({ id: d.id, a: d.data() as ApiAgreement }))
      .filter(({ a }) => !agreementLapsed(a, now) && a.merchantId !== uid)
      .sort((x, y) => y.a.createdAt.toMillis() - x.a.createdAt.toMillis())
      .slice(0, MAX_PENDING);
    const caps = new Map<string, { maxChargeUsdCents: number; dailyUsdCents: number }>();
    for (const { a } of open) {
      if (caps.has(a.merchantId)) continue;
      const partner = await getPartner(a.merchantId);
      caps.set(a.merchantId, partner?.agreementsEnabled ? agreementCapsOf(partner) : { maxChargeUsdCents: 0, dailyUsdCents: 0 });
    }
    const agreements = open.map(({ id, a }) => ({ ...view(id, a, caps.get(a.merchantId)!), signup: a.signup === true }));
    const newestSignup = open.find(({ a }) => a.signup === true)?.a;
    return {
      success: true,
      data: {
        agreements,
        prefill: {
          fullName: newestSignup?.customerName ?? null,
          zaadNumber: newestSignup ? zaadSuggestion(phone) : null,
        },
      },
    };
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
