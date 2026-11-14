/**
 * Agreements: a customer pays a partner without leaving the partner's app.
 *
 *   POST /v1/agreements                  {customer_phone, device_public_key, device_label?, reference?}
 *   GET  /v1/agreements/:id
 *   POST /v1/agreements/:id/revoke
 *   POST /v1/charges  {..., agreement}   charge on an agreement: awaits the phone's approval
 *   POST /v1/charges/:id/confirm         {signature}: the phone's approval; pays the charge
 *
 * Built for Ridy riders paying fares inside Ridy. The customer links once, in
 * Zapp, with their PIN (approveApiAgreement.ts). The partner's app made a key
 * pair on the phone's secure chip that only the customer's face, fingerprint
 * or phone passcode can use, and the agreement holds its public half. Each
 * payment is then approved on the phone: the key signs a text naming that one
 * charge and its amount (agreementSignature.ts), and Zapp checks it here.
 *
 * So neither half alone can take money: the partner's API key cannot without
 * the phone, and the phone cannot without the partner's key.
 *
 * An agreement charge is an ordinary charge (charges.ts) with `agreementId`
 * and `autoPay`. It stays pending until paid, so whenever the phone's approval
 * can't be used (over a cap, a short balance, the agreement switched off) the
 * customer can still approve it in Zapp with the PIN, as any charge.
 *
 * Partners only: the merchant must have agreements on, set by ops, and the key
 * must carry the `agreements` scope (partners.ts).
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import { User } from "../types";
import { computePaymentFee, getRates } from "../config/rates";
import { assertAccountActive, requireActiveAccount } from "../utils/accountStatus";
import { validatePhoneNumber } from "../utils/validation";
import { notifyPaymentReceived, notifyPaymentSent, sendPushNotification } from "../utils/notifications";
import { PushMessage } from "../utils/pushTemplates";
import { pushAmount, toLimitCents } from "../utils/money";
import { FrozenAccountError, InsufficientBalanceError, WalletNotFoundError } from "../ledger";
import { ApiCaller, isMerchantAccount } from "./keys";
import { ApiError, badRequest, conflict, notFound } from "./http";
import { parseOptionalString, isLapsed, getOwnCharge, serializeCharge } from "./charges";
import { idempotencyDocId, idempotencyMismatch, requestFingerprint } from "./requestGuards";
import { chargeFeeRateFor, requireAgreementPartner, agreementCapsOf } from "./partners";
import { transferDayKey } from "./transfers";
import { assertCustomerMaySpend, settleChargeInTx } from "./settleCharge";
import { chargeConfirmationPayload, isP256PublicKey, signatureValid } from "./agreementSignature";
import {
  AGREEMENT_DAYS_SUBCOLLECTION,
  API_AGREEMENTS_COLLECTION,
  API_CHARGES_COLLECTION,
  API_IDEMPOTENCY_COLLECTION,
  AgreementDay,
  ApiAgreement,
  ApiAgreementStatus,
  ApiCharge,
  ApiIdempotencyRecord,
  AutoDeclineCode,
  ChargeAutoPay,
} from "./types";

export const AGREEMENT_ID_PATTERN = /^agr_[A-Za-z0-9_-]{16,64}$/;
export const AGREEMENT_TTL_MS = 15 * 60 * 1000;
/** Confirms refused for a bad signature before the charge falls back to Zapp. */
export const MAX_BAD_SIGNATURES = 5;
const MAX_LABEL = 40;
const MAX_REFERENCE = 128;

export function newAgreementId(): string {
  return `agr_${crypto.randomBytes(18).toString("base64url")}`;
}

export function agreementDeepLink(id: string): string {
  return `zapppay://agreement/${id}`;
}

export function agreementLapsed(a: Pick<ApiAgreement, "status" | "expiresAt">, now = Date.now()): boolean {
  return a.status === "pending" && now > a.expiresAt.toMillis();
}

export function effectiveAgreementStatus(a: ApiAgreement, now = Date.now()): ApiAgreementStatus {
  return agreementLapsed(a, now) ? "expired" : a.status;
}

const iso = (ts?: FirebaseFirestore.Timestamp) => (ts ? ts.toDate().toISOString() : null);

/** The agreement as the partner sees it. Never the public key. */
export function serializeAgreement(id: string, a: ApiAgreement, now = Date.now()) {
  return {
    id,
    object: "agreement",
    status: effectiveAgreementStatus(a, now),
    customer_phone: a.customerPhone,
    device_label: a.deviceLabel ?? null,
    reference: a.reference ?? null,
    deep_link: agreementDeepLink(id),
    max_charge: a.maxChargeUsdCents ?? null,
    daily_limit: a.dailyUsdCents ?? null,
    created: iso(a.createdAt),
    expires_at: iso(a.expiresAt),
    approved_at: iso(a.approvedAt),
    revoked_at: iso(a.revokedAt),
    livemode: a.livemode,
  };
}

// ─── Creating, reading, revoking ───────────────────────────────────────────

interface NormalisedAgreementInput {
  customerPhone: string;
  devicePublicKey: string;
  deviceLabel?: string;
  reference?: string;
}

export function parseAgreementInput(
  body: Record<string, unknown>,
  testPhoneNumbers: readonly string[] = []
): NormalisedAgreementInput {
  const phone = typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";
  if (!(validatePhoneNumber(phone) || testPhoneNumbers.includes(phone))) {
    throw badRequest("phone_invalid", "customer_phone must be in international format, e.g. +252634123456", "customer_phone");
  }
  const key = typeof body.device_public_key === "string" ? body.device_public_key.trim() : "";
  if (!key || key.length > 400 || !isP256PublicKey(key)) {
    throw badRequest(
      "device_key_invalid",
      "device_public_key must be an EC P-256 public key, base64 SPKI DER",
      "device_public_key"
    );
  }
  const label = parseOptionalString(body.device_label, "device_label", 200)?.trim().slice(0, MAX_LABEL);
  return {
    customerPhone: phone,
    devicePublicKey: key,
    deviceLabel: label || undefined,
    reference: parseOptionalString(body.reference, "reference", MAX_REFERENCE),
  };
}

export async function createAgreement(
  caller: ApiCaller,
  body: Record<string, unknown>,
  idempotencyKey: string
): Promise<{ id: string; agreement: ApiAgreement; replayed: boolean }> {
  const partner = await requireAgreementPartner(caller);
  const input = parseAgreementInput(body, partner.testPhoneNumbers ?? []);
  const db = admin.firestore();
  const idemRef = db
    .collection(API_IDEMPOTENCY_COLLECTION)
    .doc(idempotencyDocId(caller.merchantId, "agreement", idempotencyKey, caller.livemode));
  const requestHash = requestFingerprint(input);

  const replay = async (record: ApiIdempotencyRecord) => {
    if (record.requestHash !== requestHash) throw idempotencyMismatch();
    const snap = await db.collection(API_AGREEMENTS_COLLECTION).doc(record.objectId).get();
    return { id: snap.id, agreement: snap.data() as ApiAgreement, replayed: true };
  };

  const prior = await idemRef.get();
  if (prior.exists) return replay(prior.data() as ApiIdempotencyRecord);

  const now = admin.firestore.Timestamp.now();
  const ref = db.collection(API_AGREEMENTS_COLLECTION).doc(newAgreementId());
  const merchantName = await merchantNameOf(caller);
  const agreement: ApiAgreement = {
    merchantId: caller.merchantId,
    merchantName,
    livemode: caller.livemode,
    keyId: caller.keyId,
    customerPhone: input.customerPhone,
    status: "pending",
    devicePublicKey: input.devicePublicKey,
    ...(input.deviceLabel ? { deviceLabel: input.deviceLabel } : {}),
    ...(input.reference ? { reference: input.reference } : {}),
    createdAt: now,
    expiresAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + AGREEMENT_TTL_MS),
  };

  const outcome = await db.runTransaction(async (tx): Promise<{ record: ApiIdempotencyRecord } | { created: true }> => {
    const idem = await tx.get(idemRef);
    if (idem.exists) return { record: idem.data() as ApiIdempotencyRecord };
    tx.create(ref, agreement);
    tx.create(idemRef, {
      merchantId: caller.merchantId,
      scope: "agreement",
      requestHash,
      objectId: ref.id,
      createdAt: now,
    } as ApiIdempotencyRecord);
    return { created: true as const };
  });
  if ("record" in outcome) return replay(outcome.record);
  return { id: ref.id, agreement, replayed: false };
}

async function merchantNameOf(caller: ApiCaller): Promise<string> {
  const profile = await admin.firestore().collection("merchantProfiles").doc(caller.merchantId).get();
  const businessName = profile.exists ? (profile.data()?.businessName as string | undefined) : undefined;
  return businessName || caller.merchant.fullName || "Zapp Pay Merchant";
}

/** The caller's own agreement in the caller's mode; any other reads as none. */
export async function getOwnAgreement(caller: ApiCaller, id: string): Promise<ApiAgreement> {
  if (!AGREEMENT_ID_PATTERN.test(id)) throw notFound("agreement");
  const snap = await admin.firestore().collection(API_AGREEMENTS_COLLECTION).doc(id).get();
  const a = snap.data() as ApiAgreement | undefined;
  if (!a || a.merchantId !== caller.merchantId || a.livemode !== caller.livemode) throw notFound("agreement");
  return a;
}

/** Revoke an agreement. Revoking one that is already over returns it unchanged. */
export async function revokeAgreementById(
  id: string,
  by: NonNullable<ApiAgreement["revokedBy"]>,
  check: (a: ApiAgreement) => void
): Promise<ApiAgreement> {
  const db = admin.firestore();
  const ref = db.collection(API_AGREEMENTS_COLLECTION).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const a = snap.data() as ApiAgreement | undefined;
    if (!a) throw notFound("agreement");
    check(a);
    const status = effectiveAgreementStatus(a);
    if (status === "revoked" || status === "expired") return { ...a, status };
    const update = { status: "revoked" as const, revokedAt: admin.firestore.Timestamp.now(), revokedBy: by };
    tx.update(ref, update);
    return { ...a, ...update };
  });
}

export async function revokeOwnAgreement(caller: ApiCaller, id: string): Promise<ApiAgreement> {
  await requireAgreementPartner(caller);
  await getOwnAgreement(caller, id);
  return revokeAgreementById(id, "merchant", () => undefined);
}

// ─── Charging on an agreement ──────────────────────────────────────────────

/**
 * Whether [agreement] may approve a charge from [caller] to [customerPhone]
 * for [usdCents] now, or why not. Pure.
 */
export function agreementRefusal(
  agreement: ApiAgreement | undefined,
  caller: Pick<ApiCaller, "merchantId" | "livemode">,
  customerPhone: string | undefined,
  usdCents: number,
  now = Date.now()
): AutoDeclineCode | null {
  // One code for all of these, so a partner can't probe other partners' ids.
  if (
    !agreement ||
    agreement.merchantId !== caller.merchantId ||
    agreement.livemode !== caller.livemode ||
    effectiveAgreementStatus(agreement, now) !== "active"
  ) {
    return "agreement_not_active";
  }
  if (!customerPhone || agreement.customerPhone !== customerPhone) return "customer_mismatch";
  if (usdCents > (agreement.maxChargeUsdCents ?? 0)) return "over_charge_limit";
  return null;
}

/**
 * Called by createCharge for a charge with `agreement`, before it is written:
 * what the new charge's `autoPay` is. Never moves money.
 */
export async function initialAutoPay(
  caller: ApiCaller,
  agreementId: string,
  charge: Pick<ApiCharge, "amount" | "currency" | "customerPhone">
): Promise<ChargeAutoPay> {
  const snap = AGREEMENT_ID_PATTERN.test(agreementId)
    ? await admin.firestore().collection(API_AGREEMENTS_COLLECTION).doc(agreementId).get()
    : undefined;
  const { slsPerUsd } = await getRates();
  const refusal = agreementRefusal(
    snap?.data() as ApiAgreement | undefined,
    caller,
    charge.customerPhone,
    toLimitCents(charge.amount, charge.currency, slsPerUsd)
  );
  return refusal ? { status: "declined", declinedCode: refusal } : { status: "requires_confirmation" };
}

/** The "approve in Zapp" push, for a charge the phone's approval can't pay. */
async function pushPaymentRequest(chargeId: string, charge: ApiCharge, customerId: string | undefined) {
  if (!customerId) return;
  const amount = pushAmount(charge.amount, charge.currency);
  const message: PushMessage = charge.reference
    ? { key: "payment.request_with_reference", params: { merchant: charge.merchantName, amount, reference: charge.reference } }
    : { key: "payment.request", params: { merchant: charge.merchantName, amount } };
  await sendPushNotification(customerId, message, {
    type: "api_charge",
    chargeId,
    merchantName: charge.merchantName,
    amount: charge.amount.toString(),
    currency: charge.currency,
    expiresAt: charge.expiresAt.toDate().toISOString(),
    ...(charge.reference ? { reference: charge.reference } : {}),
  }).catch((err) => console.error("Failed to notify customer of API charge:", err));
}

export { pushPaymentRequest };

class Decline extends Error {
  constructor(readonly code: AutoDeclineCode) {
    super(code);
  }
}

/**
 * POST /v1/charges/:id/confirm — pay an agreement charge with the phone's
 * signature. A refusal the customer can get around in Zapp is an answer (the
 * charge, `auto_pay.status: "declined"`), not an error; a bad signature is an
 * error and changes nothing, so the customer can try again.
 */
export async function confirmAgreementCharge(caller: ApiCaller, chargeId: string, body: Record<string, unknown>) {
  await requireAgreementPartner(caller);
  const db = admin.firestore();
  const chargeRef = db.collection(API_CHARGES_COLLECTION).doc(chargeId);
  const pre = await getOwnCharge(caller.merchantId, chargeId, caller.livemode);

  // A retry, or the customer approved it in Zapp instead.
  if (pre.status === "succeeded") return serializeCharge(chargeId, pre);

  if (pre.status !== "pending" || isLapsed(pre) || !pre.agreementId || pre.autoPay?.status !== "requires_confirmation") {
    throw conflict("charge_not_confirmable", "This charge is not waiting for the customer's approval on their phone");
  }
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (!signature || signature.length > 512) throw badRequest("parameter_invalid", "signature is required", "signature");

  const agreementRef = db.collection(API_AGREEMENTS_COLLECTION).doc(pre.agreementId);
  const agreement = (await agreementRef.get()).data() as ApiAgreement | undefined;
  const { slsPerUsd, onlinePaymentFeeRate: standardRate } = await getRates();
  const usdCents = toLimitCents(pre.amount, pre.currency, slsPerUsd);

  const decline = async (code: AutoDeclineCode) => {
    const after = await db.runTransaction(async (tx) => {
      const c = (await tx.get(chargeRef)).data() as ApiCharge;
      if (c.status !== "pending" || c.autoPay?.status !== "requires_confirmation") return c;
      const autoPay: ChargeAutoPay = { ...c.autoPay, status: "declined", declinedCode: code };
      tx.update(chargeRef, { autoPay });
      return { ...c, autoPay };
    });
    if (after.autoPay?.status === "declined") await pushPaymentRequest(chargeId, after, agreement?.customerId);
    return serializeCharge(chargeId, after);
  };

  const refusal = agreementRefusal(agreement, caller, pre.customerPhone, usdCents);
  if (refusal) return decline(refusal);

  const payload = chargeConfirmationPayload({
    chargeId,
    agreementId: pre.agreementId,
    amount: pre.amount,
    currency: pre.currency,
  });
  if (!signatureValid(agreement!.devicePublicKey, payload, signature)) {
    const bad = (pre.autoPay?.badSignatures ?? 0) + 1;
    await chargeRef.update({ "autoPay.badSignatures": bad });
    if (bad >= MAX_BAD_SIGNATURES) return decline("agreement_not_active");
    throw new ApiError(402, "invalid_request_error", "signature_invalid", "The signature does not match this charge");
  }

  // Test mode: nobody's money; settle as the test helpers do.
  if (!caller.livemode) {
    const feeRate = await chargeFeeRateFor(caller.merchantId, standardRate);
    const after = await db.runTransaction(async (tx) => {
      const c = (await tx.get(chargeRef)).data() as ApiCharge;
      if (c.status === "succeeded") return c;
      const now = admin.firestore.Timestamp.now();
      const feeCents = computePaymentFee(c.amount, feeRate);
      const update = {
        status: "succeeded" as const,
        succeededAt: now,
        feeCents,
        netCents: c.amount - feeCents,
        autoPay: { ...c.autoPay!, status: "paid" as const },
      };
      tx.update(chargeRef, update);
      return { ...c, ...update };
    });
    return serializeCharge(chargeId, after);
  }

  const customerId = agreement!.customerId!;
  try {
    try {
      await requireActiveAccount(customerId);
    } catch (e) {
      if (e instanceof https.HttpsError) throw new Decline("account_unavailable");
      throw e;
    }
    try {
      await assertCustomerMaySpend(customerId, pre);
    } catch (e) {
      if (e instanceof https.HttpsError) throw new Decline("customer_limit");
      throw e;
    }

    // Roles and status can change between the charge and the approval; that is the partner's own problem.
    const merchant = (await db.collection("users").doc(pre.merchantId).get()).data() as User | undefined;
    if (!merchant || !isMerchantAccount(merchant)) {
      throw conflict("merchant_unavailable", "This merchant can no longer take payments");
    }
    try {
      assertAccountActive(merchant, "counterparty");
    } catch {
      throw conflict("merchant_unavailable", "This merchant can no longer take payments");
    }

    const feeRate = await chargeFeeRateFor(pre.merchantId, standardRate);
    const transactionId = db.collection("transactions").doc().id;
    const dayRef = agreementRef.collection(AGREEMENT_DAYS_SUBCOLLECTION).doc(transferDayKey(new Date()));

    const outcome = await db.runTransaction(async (tx) => {
      const a = (await tx.get(agreementRef)).data() as ApiAgreement | undefined;
      const day = ((await tx.get(dayRef)).data() as AgreementDay | undefined) ?? { usdCents: 0, count: 0 };
      const c = (await tx.get(chargeRef)).data() as ApiCharge;
      if (c.status === "succeeded") return { charge: c };
      const now = admin.firestore.Timestamp.now();
      if (c.status !== "pending" || isLapsed(c, now.toMillis()) || c.autoPay?.status !== "requires_confirmation") {
        throw conflict("charge_not_confirmable", "This charge is not waiting for the customer's approval on their phone");
      }
      const again = agreementRefusal(a, caller, c.customerPhone, usdCents, now.toMillis());
      if (again) throw new Decline(again);
      if (day.usdCents + usdCents > (a!.dailyUsdCents ?? 0)) throw new Decline("over_daily_limit");

      const settled = await settleChargeInTx(tx, {
        chargeRef,
        chargeId,
        charge: c,
        customerId,
        feeRate,
        transactionId,
        now,
        extra: {
          charge: { autoPay: { ...c.autoPay, status: "paid" } },
          row: { approvedVia: "partner_device", apiAgreementId: c.agreementId },
        },
      });
      tx.set(dayRef, { usdCents: day.usdCents + usdCents, count: day.count + 1 });
      return { charge: c, settled };
    });

    if ("settled" in outcome && outcome.settled?.kind === "paid") {
      const { charge, netCents } = outcome.settled;
      notifyPaymentReceived(charge.merchantId, netCents, charge.currency, customerId).catch((err) =>
        console.error("Failed to notify merchant:", err)
      );
      notifyPaymentSent(customerId, charge.amount, charge.currency, charge.merchantId).catch((err) =>
        console.error("Failed to notify customer:", err)
      );
      console.log(`API charge ${chargeId} paid under agreement ${charge.agreementId}`);
    }
    return serializeCharge(chargeId, (await chargeRef.get()).data() as ApiCharge);
  } catch (err) {
    if (err instanceof Decline) return decline(err.code);
    if (err instanceof InsufficientBalanceError) return decline("insufficient_balance");
    if (err instanceof FrozenAccountError || err instanceof WalletNotFoundError) return decline("account_unavailable");
    throw err;
  }
}
