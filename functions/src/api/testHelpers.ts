/**
 * Test mode: settle a test charge without anyone paying it.
 *
 * A charge raised with a `zpk_test_` key cannot be approved in the app
 * (approveApiCharge refuses it), so besides cancel and the expiry sweep these
 * are the only ways one resolves. Nothing here posts to the ledger or writes a
 * transaction — a test charge has no money behind it — and every path refuses
 * a live charge.
 *
 *   POST /v1/test_helpers/charges/:id/succeed   test key
 *   POST /v1/test_helpers/charges/:id/expire    test key
 *   POST /v1/public/charges/:id/test_payment    the hosted checkout's "Simulate payment"
 *
 * The public route needs no key, the same as the checkout page that calls it:
 * whoever holds a test charge's link may "pay" it, which is what test mode is
 * for. A live charge's link can do nothing here.
 */

import * as admin from "firebase-admin";
import { computePaymentFee, getRates } from "../config/rates";
import { ApiError, badRequest, conflict, notFound } from "./http";
import { CHARGE_ID_PATTERN, isLapsed } from "./charges";
import { API_CHARGES_COLLECTION, ApiCharge, isLiveObject } from "./types";

export type TestOutcome = "succeeded" | "expired";

export function testModeOnly(): ApiError {
  return badRequest(
    "test_mode_only",
    "Test helpers work only on test charges, with a zpk_test_ key"
  );
}

/**
 * Resolve a pending test charge. `merchantId` scopes it to the caller when a
 * key is involved; the public route passes none.
 *
 * Settling a charge that already reached the requested outcome returns it
 * unchanged, so a double tap on the checkout page is harmless.
 */
export async function settleTestCharge(
  chargeId: string,
  outcome: TestOutcome,
  merchantId?: string
): Promise<ApiCharge> {
  if (!CHARGE_ID_PATTERN.test(chargeId)) throw notFound("charge");
  const db = admin.firestore();
  const ref = db.collection(API_CHARGES_COLLECTION).doc(chargeId);
  const { onlinePaymentFeeRate } = await getRates();

  type Result = { charge: ApiCharge } | { lapsed: true };
  const result = await db.runTransaction(async (tx): Promise<Result> => {
    const snap = await tx.get(ref);
    const charge = snap.data() as ApiCharge | undefined;
    if (!charge || (merchantId !== undefined && charge.merchantId !== merchantId)) {
      throw notFound("charge");
    }
    if (isLiveObject(charge)) throw testModeOnly();

    if (charge.status === outcome) return { charge };
    if (charge.status !== "pending") {
      throw conflict("charge_not_pending", `This charge is already ${charge.status}`);
    }

    const now = admin.firestore.Timestamp.now();
    if (outcome === "expired" || isLapsed(charge, now.toMillis())) {
      const update: Partial<ApiCharge> = { status: "expired", expiredAt: now };
      tx.update(ref, update);
      // Record a lapse, then refuse once committed: throwing in here would roll it back.
      return outcome === "expired" ? { charge: { ...charge, ...update } } : { lapsed: true };
    }

    // The numbers a live payment of this amount would show, so integrators
    // can test their fee and payout handling.
    const feeCents = computePaymentFee(charge.amount, onlinePaymentFeeRate);
    const update: Partial<ApiCharge> = {
      status: "succeeded",
      succeededAt: now,
      feeCents,
      netCents: charge.amount - feeCents,
    };
    tx.update(ref, update);
    return { charge: { ...charge, ...update } };
  });

  if ("lapsed" in result) {
    throw conflict("charge_expired", "This charge expired before it was paid");
  }
  return result.charge;
}
