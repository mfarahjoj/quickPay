/**
 * Granting, changing and withdrawing staff access (STAFF_ACCESS.md).
 *
 * Only the shop's own account manages its staff, and that power is never
 * grantable: these callables take no merchantId, so a staff member calling
 * them manages only staff of a shop they themselves own, which is none.
 *
 *   shop   staffInvite   phone + role + PIN → grant "invited", push to them
 *   staff  staffRespond  accept → "active" | decline → "declined"
 *   shop   staffUpdate   role / showCustomers + PIN; signs their computers out
 *   shop   staffRemove   → "revoked"; signs their computers out
 *   staff  staffLeave    → "left"; signs their computers out
 *
 * Every change is appended to merchantStaffAudit.
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { https } from "firebase-functions/v2";
import { verifyUserPin } from "../auth/validatePin";
import { MERCHANT_TYPES } from "../counterDisplay/guard";
import { shopName } from "../counterDisplay/state";
import { normaliseSomaliPhone } from "../portal/groups";
import { endStaffPortalSessions } from "../portal/sessions";
import { assertAccountActive } from "../utils/accountStatus";
import { notifyUser } from "../utils/notifications";
import type { PushMessage } from "../utils/pushTemplates";
import { requireAuth } from "../utils/validation";
import {
  grantId,
  isStaffRole,
  MAX_REFUND_CAP_CENTS,
  MAX_REFUND_DAY_CAP_CENTS,
  MAX_STAFF_PER_SHOP,
  MERCHANT_STAFF,
  MERCHANT_STAFF_AUDIT,
  StaffAuditAction,
  StaffGrant,
  StaffRole,
} from "./types";

const UID = /^[A-Za-z0-9_-]{1,128}$/;

function validUid(value: unknown, what: string): string {
  if (typeof value !== "string" || !UID.test(value)) {
    throw new https.HttpsError("invalid-argument", `${what} is required`);
  }
  return value;
}

/** The caller, as a shop that may manage staff. */
async function requireShopOwner(request: https.CallableRequest) {
  requireAuth(request);
  const uid = request.auth!.uid;
  const db = admin.firestore();
  const [userSnap, profileSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("merchantProfiles").doc(uid).get(),
  ]);
  const user = userSnap.data();
  if (!userSnap.exists || !MERCHANT_TYPES.includes(user?.accountType)) {
    throw new https.HttpsError("permission-denied", "Only a shop can manage its staff.", { reason: "staff_not_shop" });
  }
  assertAccountActive(user);
  return { uid, name: shopName(user, profileSnap.data()) };
}

async function requirePin(uid: string, pin: unknown): Promise<void> {
  if (typeof pin !== "string" || !pin) throw new https.HttpsError("invalid-argument", "PIN is required");
  if (!(await verifyUserPin(uid, pin))) throw new https.HttpsError("permission-denied", "Invalid PIN");
}

function audit(
  tx: FirebaseFirestore.Transaction,
  grant: Pick<StaffGrant, "merchantUid" | "staffUid" | "role" | "showCustomers" | "refundCapCents" | "refundDayCapCents">,
  byUid: string,
  action: StaffAuditAction,
  previousRole?: StaffRole
): void {
  const ref = admin.firestore().collection(MERCHANT_STAFF_AUDIT).doc();
  tx.create(ref, {
    merchantUid: grant.merchantUid,
    staffUid: grant.staffUid,
    byUid,
    action,
    role: grant.role,
    showCustomers: grant.showCustomers,
    ...(previousRole ? { previousRole } : {}),
    ...(grant.refundCapCents ? { refundCapCents: grant.refundCapCents } : {}),
    ...(grant.refundDayCapCents ? { refundDayCapCents: grant.refundDayCapCents } : {}),
    at: Timestamp.now(),
  });
}

/**
 * Manager refund caps from the owner's request. Both zero (or omitted) turns
 * refunds off; otherwise both must be whole cents above zero, within the
 * highest caps, with the day cap at least one refund.
 */
function refundCaps(perRefund: unknown, perDay: unknown): Pick<StaffGrant, "refundCapCents" | "refundDayCapCents"> {
  const each = perRefund === undefined || perRefund === null ? 0 : perRefund;
  const day = perDay === undefined || perDay === null ? 0 : perDay;
  if (each === 0 && day === 0) return {};
  const ok = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;
  if (!ok(each, MAX_REFUND_CAP_CENTS) || !ok(day, MAX_REFUND_DAY_CAP_CENTS) || day < each) {
    throw new https.HttpsError(
      "invalid-argument",
      "Set a refund limit and a daily limit at least as large, or turn refunds off.",
      { reason: "staff_bad_refund_caps", maxCents: MAX_REFUND_CAP_CENTS, maxDayCents: MAX_REFUND_DAY_CAP_CENTS }
    );
  }
  return { refundCapCents: each, refundDayCapCents: day };
}

function push(uid: string, message: PushMessage) {
  notifyUser(uid, "staff", message, { type: "staff" }).catch((err) => console.error(`Staff push ${message.key} failed:`, err));
}

function grantOut(id: string, g: StaffGrant) {
  return {
    grantId: id,
    merchantUid: g.merchantUid,
    staffUid: g.staffUid,
    role: g.role,
    status: g.status,
    showCustomers: g.showCustomers,
    refundCapCents: g.refundCapCents ?? 0,
    refundDayCapCents: g.refundDayCapCents ?? 0,
    shopName: g.shopName,
    staffName: g.staffName,
    staffPhone: g.staffPhone,
  };
}

// ─── Shop: invite ──────────────────────────────────────────────────────────

export const staffInvite = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ phone?: unknown; role?: unknown; showCustomers?: unknown; pin?: unknown }>) => {
    const shop = await requireShopOwner(request);
    const phone = normaliseSomaliPhone(request.data?.phone);
    if (!phone) {
      throw new https.HttpsError("invalid-argument", "Enter their Zapp phone number.", { reason: "staff_bad_phone" });
    }
    const role = request.data?.role;
    if (!isStaffRole(role)) throw new https.HttpsError("invalid-argument", "role must be waiter, cashier or manager");
    const showCustomers = role === "manager" && request.data?.showCustomers === true;
    await requirePin(shop.uid, request.data?.pin);

    const db = admin.firestore();
    const found = await db.collection("users").where("phoneNumber", "==", phone).limit(2).get();
    const person = found.docs[0];
    if (!person) {
      throw new https.HttpsError("not-found", "Nobody uses Zapp Pay with that number yet. Ask them to install Zapp Pay first.", {
        reason: "staff_no_account",
      });
    }
    const staffUid = person.id;
    if (staffUid === shop.uid) {
      throw new https.HttpsError("invalid-argument", "That's this shop's own number.", { reason: "staff_self" });
    }
    // Staff are people, not businesses: a shop or agent account already has a
    // merchant app of its own and would be confused with one acting for this shop.
    if (person.data().accountType !== "customer") {
      throw new https.HttpsError("failed-precondition", "That number belongs to a business account.", {
        reason: "staff_not_customer",
      });
    }
    assertAccountActive(person.data(), "counterparty");

    const ref = db.collection(MERCHANT_STAFF).doc(grantId(shop.uid, staffUid));
    const staffName = (person.data().fullName as string) || phone;
    const grant = await db.runTransaction(async (tx) => {
      const [snap, current] = await Promise.all([
        tx.get(ref),
        tx.get(db.collection(MERCHANT_STAFF).where("merchantUid", "==", shop.uid).where("status", "in", ["invited", "active"])),
      ]);
      const existing = snap.data() as StaffGrant | undefined;
      if (existing?.status === "active" || existing?.status === "invited") {
        throw new https.HttpsError("already-exists", "They're already on your staff list.", { reason: "staff_exists" });
      }
      if (current.size >= MAX_STAFF_PER_SHOP) {
        throw new https.HttpsError("resource-exhausted", `Up to ${MAX_STAFF_PER_SHOP} staff.`, { reason: "staff_limit" });
      }
      const now = Timestamp.now();
      const next: StaffGrant = {
        merchantUid: shop.uid,
        staffUid,
        role,
        status: "invited",
        showCustomers,
        shopName: shop.name,
        staffName,
        staffPhone: phone,
        invitedAt: now,
        updatedAt: now,
      };
      tx.set(ref, next);
      audit(tx, next, shop.uid, "invited");
      return next;
    });

    push(staffUid, { key: "staff.invited", params: { shop: shop.name } });
    return { success: true, data: grantOut(ref.id, grant) };
  }
);

// ─── Staff: accept or decline, leave ───────────────────────────────────────

export const staffRespond = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ merchantId?: unknown; accept?: unknown }>) => {
    requireAuth(request);
    const staffUid = request.auth!.uid;
    const merchantUid = validUid(request.data?.merchantId, "merchantId");
    const accept = request.data?.accept === true;
    const db = admin.firestore();
    if (accept) {
      assertAccountActive((await db.collection("users").doc(staffUid).get()).data());
    }
    const ref = db.collection(MERCHANT_STAFF).doc(grantId(merchantUid, staffUid));

    const grant = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const g = snap.data() as StaffGrant | undefined;
      if (!snap.exists || !g || g.status !== "invited") {
        throw new https.HttpsError("not-found", "That invitation isn't open any more.", { reason: "staff_invite_not_found" });
      }
      const now = Timestamp.now();
      const next: StaffGrant = accept
        ? { ...g, status: "active", acceptedAt: now, updatedAt: now }
        : { ...g, status: "declined", endedAt: now, updatedAt: now };
      tx.set(ref, next);
      audit(tx, next, staffUid, accept ? "accepted" : "declined");
      return next;
    });

    if (accept) push(merchantUid, { key: "staff.accepted", params: { name: grant.staffName } });
    return { success: true, data: grantOut(ref.id, grant) };
  }
);

export const staffLeave = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ merchantId?: unknown }>) => {
    requireAuth(request);
    const staffUid = request.auth!.uid;
    const merchantUid = validUid(request.data?.merchantId, "merchantId");
    const db = admin.firestore();
    const ref = db.collection(MERCHANT_STAFF).doc(grantId(merchantUid, staffUid));

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const g = snap.data() as StaffGrant | undefined;
      if (!snap.exists || !g || (g.status !== "active" && g.status !== "invited")) return;
      const now = Timestamp.now();
      const next: StaffGrant = { ...g, status: "left", endedAt: now, updatedAt: now };
      tx.set(ref, next);
      audit(tx, next, staffUid, "left");
    });
    await endStaffPortalSessions(merchantUid, staffUid, "revoked");
    return { success: true, data: { status: "left" } };
  }
);

// ─── Shop: change, remove ──────────────────────────────────────────────────

export const staffUpdate = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{
    staffUid?: unknown;
    role?: unknown;
    showCustomers?: unknown;
    /** Manager refund caps in US cents; both above zero turns refunds on, 0 or omitted turns them off. */
    refundCapCents?: unknown;
    refundDayCapCents?: unknown;
    pin?: unknown;
  }>) => {
    const shop = await requireShopOwner(request);
    const staffUid = validUid(request.data?.staffUid, "staffUid");
    const role = request.data?.role;
    if (!isStaffRole(role)) throw new https.HttpsError("invalid-argument", "role must be waiter, cashier or manager");
    const showCustomers = role === "manager" && request.data?.showCustomers === true;
    const caps = role === "manager" ? refundCaps(request.data?.refundCapCents, request.data?.refundDayCapCents) : {};
    await requirePin(shop.uid, request.data?.pin);

    const db = admin.firestore();
    const ref = db.collection(MERCHANT_STAFF).doc(grantId(shop.uid, staffUid));
    const grant = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const g = snap.data() as StaffGrant | undefined;
      if (!snap.exists || !g || (g.status !== "active" && g.status !== "invited")) {
        throw new https.HttpsError("not-found", "They aren't on your staff list.", { reason: "staff_not_found" });
      }
      const { refundCapCents: _cap, refundDayCapCents: _day, ...rest } = g;
      const next: StaffGrant = { ...rest, role, showCustomers, ...caps, updatedAt: Timestamp.now() };
      tx.set(ref, next);
      audit(tx, next, shop.uid, "changed", g.role);
      return { next, sessionChanged: g.role !== role || g.showCustomers !== showCustomers };
    });

    // A Zapp Business session carries the role it was signed in with, so a
    // change of role or of "Show customers" signs that person's computers out;
    // they sign in again under the new one. Refund caps aren't on the session.
    if (grant.sessionChanged) await endStaffPortalSessions(shop.uid, staffUid, "revoked");
    return { success: true, data: grantOut(ref.id, grant.next) };
  }
);

export const staffRemove = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ staffUid?: unknown }>) => {
    const shop = await requireShopOwner(request);
    const staffUid = validUid(request.data?.staffUid, "staffUid");
    const db = admin.firestore();
    const ref = db.collection(MERCHANT_STAFF).doc(grantId(shop.uid, staffUid));

    const removed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const g = snap.data() as StaffGrant | undefined;
      if (!snap.exists || !g || (g.status !== "active" && g.status !== "invited")) return false;
      const now = Timestamp.now();
      const next: StaffGrant = { ...g, status: "revoked", endedAt: now, updatedAt: now };
      tx.set(ref, next);
      audit(tx, next, shop.uid, "removed");
      return true;
    });

    await endStaffPortalSessions(shop.uid, staffUid, "revoked");
    if (removed) push(staffUid, { key: "staff.removed", params: { shop: shop.name } });
    return { success: true, data: { status: "revoked" } };
  }
);
