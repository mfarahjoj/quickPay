/**
 * Who am I sending to? The customer's Send money step.
 *
 * `lookupUserByPhone` is for agents and merchants and refuses everyone else,
 * so since role approval landed a customer's Send money stopped at "Not
 * authorized to lookup users". This is the customer-facing lookup, and it
 * gives away as little as it can while still letting the payer check they
 * typed the right number:
 *
 * - a person's name comes back as first name and last initial ("Amina Y."),
 *   never the full name or the account id;
 * - closed and frozen accounts read as not found, so status doesn't leak;
 * - a business number says so, and gives the shop name its QR already shows,
 *   so the app can send the payer to the QR before they type an amount
 *   (`sendP2P` refuses it anyway);
 * - each caller gets a fixed budget of lookups an hour and a day, so the
 *   callable can't be used to walk the phone book.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { assertAccountActive, isAccountActive } from "../utils/accountStatus";
import { isMerchantRole } from "../utils/roles";
import { ApiResponse } from "../types";

export const RECIPIENT_LOOKUPS_COLLECTION = "recipient_lookups";

export const LOOKUP_LIMITS = { perHour: 30, perDay: 100 };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PHONE_REGEX = /^\+[0-9]{8,15}$/;

interface LookupRecipientRequest {
  phoneNumber: string;
}

export type LookupRecipientResponse =
  | { found: false; reason: "not_found" | "self" }
  | { found: true; phoneNumber: string; displayName: string; isBusiness: boolean };

/** "Amina Yusuf Ali" → "Amina A."; one word stays as it is. */
export function maskPersonName(fullName: unknown): string {
  const parts = typeof fullName === "string" ? fullName.trim().split(/\s+/).filter(Boolean) : [];
  if (parts.length === 0) return "Zapp Pay user";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/**
 * Count this lookup against the caller's hourly and daily budget.
 *
 * Fixed windows with blind increments, like the API rate limit: the read can
 * lag a concurrent call by one, which is fine for a budget that only exists to
 * stop bulk scraping. Docs carry `expireAt` for a TTL policy.
 */
async function spendLookup(uid: string, now: number): Promise<void> {
  const db = admin.firestore();
  const windows: Array<[string, number, number]> = [
    ["h", HOUR_MS, LOOKUP_LIMITS.perHour],
    ["d", DAY_MS, LOOKUP_LIMITS.perDay],
  ];
  for (const [tag, size, limit] of windows) {
    const bucket = Math.floor(now / size);
    const ref = db.collection(RECIPIENT_LOOKUPS_COLLECTION).doc(`${uid}_${tag}${bucket}`);
    await ref.set(
      {
        count: admin.firestore.FieldValue.increment(1),
        expireAt: admin.firestore.Timestamp.fromMillis((bucket + 2) * size),
      },
      { merge: true }
    );
    const count = (await ref.get()).data()?.count ?? 0;
    if (count > limit) {
      throw new https.HttpsError(
        "resource-exhausted",
        "Too many number lookups. Try again later.",
        { reason: "lookup_limit" }
      );
    }
  }
}

export const lookupRecipient = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<LookupRecipientRequest>
  ): Promise<ApiResponse<LookupRecipientResponse>> => {
    requireAuth(request);
    const callerId = request.auth!.uid;
    const phoneNumber = request.data?.phoneNumber;

    if (typeof phoneNumber !== "string" || !PHONE_REGEX.test(phoneNumber)) {
      throw new https.HttpsError("invalid-argument", "A phone number like +252631234567 is required");
    }

    const db = admin.firestore();
    const callerSnap = await db.collection("users").doc(callerId).get();
    if (!callerSnap.exists) {
      throw new https.HttpsError("failed-precondition", "Finish setting up your account first");
    }
    assertAccountActive(callerSnap.data());

    await spendLookup(callerId, Date.now());

    const match = await db
      .collection("users")
      .where("phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();

    if (match.empty || !isAccountActive(match.docs[0].data())) {
      return { success: true, data: { found: false, reason: "not_found" } };
    }

    const doc = match.docs[0];
    if (doc.id === callerId) {
      return { success: true, data: { found: false, reason: "self" } };
    }

    const user = doc.data();
    const isBusiness = isMerchantRole(user.accountType);
    let displayName = maskPersonName(user.fullName);
    if (isBusiness) {
      const profile = await db.collection("merchantProfiles").doc(doc.id).get();
      displayName =
        (profile.exists && (profile.data()?.businessName as string)) ||
        (user.fullName as string) ||
        "Zapp Pay merchant";
    }

    return {
      success: true,
      data: { found: true, phoneNumber, displayName, isBusiness },
    };
  }
);
