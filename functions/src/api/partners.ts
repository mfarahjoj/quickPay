/**
 * Partners: merchants ops lets pay people out of their own wallet by API.
 *
 * A partner (Ridy) collects from its customers through charges and pays its
 * workers (drivers) by transfer, with no PIN on either side of the call — the
 * API key is the credential. So two things must both be true before a
 * transfer moves money: ops has made the merchant a partner
 * (`api_partners/{merchantId}`), and the key carries the `transfers` scope,
 * which only the console grants. A key the merchant made for their till can
 * never transfer, whatever the merchant's partner status.
 */

import * as admin from "firebase-admin";
import { ApiError } from "./http";
import { ApiCaller } from "./keys";
import { API_PARTNERS_COLLECTION, ApiPartner } from "./types";

export const DEFAULT_MAX_TRANSFER_USD_CENTS = 10_000; // $100
export const DEFAULT_DAILY_TRANSFER_USD_CENTS = 200_000; // $2,000
/** Fee rates a partner may be given; above this is a typo, not a deal. */
export const MAX_PARTNER_FEE_RATE = 0.1;

export async function getPartner(merchantId: string): Promise<ApiPartner | undefined> {
  const snap = await admin.firestore().collection(API_PARTNERS_COLLECTION).doc(merchantId).get();
  return snap.exists ? (snap.data() as ApiPartner) : undefined;
}

/**
 * Refuse a caller that may not transfer or look up accounts. Both failures
 * read the same, so a till key learns nothing about the merchant's status.
 */
export async function requireTransferPartner(caller: ApiCaller): Promise<ApiPartner> {
  const partner = caller.scopes.includes("transfers") ? await getPartner(caller.merchantId) : undefined;
  if (!partner?.transfersEnabled) {
    throw new ApiError(
      403,
      "permission_error",
      "transfers_not_enabled",
      "This key cannot make transfers. Transfers are for Zapp partners; contact Zapp to apply."
    );
  }
  return partner;
}

/**
 * Zapp's fee rate on a merchant's charges: the partner's own rate when ops set
 * one, otherwise the standard rate.
 */
export async function chargeFeeRateFor(merchantId: string, standardRate: number): Promise<number> {
  const partner = await getPartner(merchantId);
  const rate = partner?.chargeFeeRate;
  return typeof rate === "number" && rate >= 0 && rate <= MAX_PARTNER_FEE_RATE ? rate : standardRate;
}
