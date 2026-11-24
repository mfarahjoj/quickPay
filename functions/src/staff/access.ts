/**
 * Who is acting for a shop, and may they?
 *
 * Callables a staff member can use take the shop's uid as `merchantId`.
 * Without it, or when it is the caller's own uid, the caller is the shop and
 * the callable's own checks apply as before. Otherwise the caller must hold an
 * active grant for that shop whose role allows the capability, and both
 * accounts must be active. The grant is read on every call, never cached in a
 * claim, so a removal takes effect on the very next request.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { MERCHANT_TYPES } from "../counterDisplay/guard";
import { assertAccountActive } from "../utils/accountStatus";
import { requireAuth } from "../utils/validation";
import { grantId, MERCHANT_STAFF, roleCan, StaffCapability, StaffGrant, StaffRole } from "./types";

export interface MerchantActor {
  /** The shop the work is done for. */
  merchantUid: string;
  /** Who is doing it: the shop itself, or a staff member. */
  actorUid: string;
  role: "owner" | StaffRole;
  grant?: StaffGrant;
}

export function staffDenied(message = "You don't have access to this for that shop."): https.HttpsError {
  return new https.HttpsError("permission-denied", message, { reason: "staff_access_denied" });
}

/** The active grant for this shop and staff member, or null. Checks nothing else. */
export async function activeGrant(merchantUid: string, staffUid: string): Promise<StaffGrant | null> {
  const snap = await admin.firestore().collection(MERCHANT_STAFF).doc(grantId(merchantUid, staffUid)).get();
  const grant = snap.data() as StaffGrant | undefined;
  return snap.exists && grant?.status === "active" ? grant : null;
}

/**
 * A staff member acting for a shop: an active grant allowing `capability`, an
 * active staff account and an active shop. Throws otherwise.
 */
export async function requireStaffGrant(
  merchantUid: string,
  staffUid: string,
  capability: StaffCapability
): Promise<StaffGrant> {
  const db = admin.firestore();
  const [grant, staffSnap, shopSnap] = await Promise.all([
    activeGrant(merchantUid, staffUid),
    db.collection("users").doc(staffUid).get(),
    db.collection("users").doc(merchantUid).get(),
  ]);
  if (!grant || !roleCan(grant.role, capability)) throw staffDenied();
  if (!staffSnap.exists) throw staffDenied();
  assertAccountActive(staffSnap.data());
  const shop = shopSnap.data();
  if (!shopSnap.exists || !MERCHANT_TYPES.includes(shop?.accountType)) throw staffDenied();
  assertAccountActive(shop, "counterparty");
  return grant;
}

export async function requireMerchantActor(
  request: https.CallableRequest,
  merchantId: unknown,
  capability: StaffCapability
): Promise<MerchantActor> {
  requireAuth(request);
  const uid = request.auth!.uid;
  if (merchantId === undefined || merchantId === null || merchantId === uid) {
    return { merchantUid: uid, actorUid: uid, role: "owner" };
  }
  if (typeof merchantId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(merchantId)) {
    throw new https.HttpsError("invalid-argument", "merchantId is invalid");
  }
  const grant = await requireStaffGrant(merchantId, uid, capability);
  return { merchantUid: merchantId, actorUid: uid, role: grant.role, grant };
}
