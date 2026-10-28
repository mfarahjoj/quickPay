/**
 * Change the account's phone number (ONBOARDING_SECURITY_REVIEW.md B5, E13).
 *
 * The phone number is how people sign in and how others pay them, but the
 * account (and its money) is the uid, so moving to a new number keeps
 * everything. It takes three proofs:
 *
 *   1. The PIN.
 *   2. The old number, by a fresh SMS sign-in (if they still have it), or
 *      the last 4 of their verified ID (if they don't).
 *   3. The new number, by SMS: the app verifies it and attaches it to the
 *      Firebase Auth account itself.
 *
 * startPhoneChange checks 1 and 2 and records an approval for that new
 * number, valid 15 minutes. The app then does 3, and completePhoneChange
 * confirms Auth now holds the approved number before moving the account's
 * phoneNumber (which lookups and payments use). Afterwards: sending is
 * paused for phoneChangeCooldownDays (default 7), other sessions end, and
 * the owner is told.
 *
 * Limit: Firebase Auth lets a signed-in client attach a new number by itself.
 * Without step 2's approval that changes only how they sign in, not the
 * number the account is known and paid by here, and the next
 * completePhoneChange refuses it.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validatePin } from "../utils/validation";
import { verifyUserPin } from "./validatePin";
import { checkIdAnswer } from "./resetPin";
import { endSessions } from "./sessions";
import { notifyUser } from "../utils/notifications";
import { getRates } from "../config/rates";
import { ApiResponse } from "../types";

const APPROVALS = "phoneChanges";
const APPROVAL_TTL_MS = 15 * 60 * 1000;
const OLD_NUMBER_PROOF_SECONDS = 5 * 60;
const PHONE = /^\+[1-9]\d{7,14}$/;

interface StartRequest {
  newPhone: string;
  pin: string;
  /** When the old number can't receive an SMS any more. */
  idLast4?: string;
}

export const startPhoneChange = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<StartRequest>): Promise<ApiResponse<{ expiresAt: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const { newPhone, pin, idLast4 } = request.data ?? {};
    if (typeof newPhone !== "string" || !PHONE.test(newPhone)) {
      throw new https.HttpsError("invalid-argument", "Enter the new number with its country code.");
    }
    if (typeof pin !== "string" || !validatePin(pin)) {
      throw new https.HttpsError("invalid-argument", "PIN must be exactly 6 digits");
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const user = (await userRef.get()).data();
    if (!user) throw new https.HttpsError("not-found", "User not found");
    if (user.phoneNumber === newPhone) {
      throw new https.HttpsError("invalid-argument", "That's already your number.");
    }

    // 1. The PIN (shared lockout).
    if (!(await verifyUserPin(uid, pin))) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    // 2. The old number, freshly verified by SMS in this session, or the ID.
    const token = request.auth!.token as { firebase?: { sign_in_provider?: string }; auth_time?: number; phone_number?: string };
    const freshOldNumber =
      token.firebase?.sign_in_provider === "phone" &&
      token.phone_number === user.phoneNumber &&
      !!token.auth_time &&
      Date.now() / 1000 - token.auth_time <= OLD_NUMBER_PROOF_SECONDS;
    if (!freshOldNumber) {
      if (idLast4 === undefined) {
        throw new https.HttpsError(
          "failed-precondition",
          "Confirm your old number by SMS, or enter the last 4 of your ID.",
          { reason: "phone_change_needs_proof" }
        );
      }
      await checkIdAnswer(userRef, uid, user, idLast4, Date.now());
    }

    // The new number mustn't belong to anyone else.
    const taken = await db.collection("users").where("phoneNumber", "==", newPhone).limit(1).get();
    let authTaken = false;
    try {
      const other = await admin.auth().getUserByPhoneNumber(newPhone);
      authTaken = other.uid !== uid;
    } catch {
      authTaken = false;
    }
    if (authTaken || taken.docs.some((d) => d.id !== uid)) {
      throw new https.HttpsError("already-exists", "That number already has a Zapp Pay account.", {
        reason: "phone_taken",
      });
    }

    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + APPROVAL_TTL_MS);
    await db.collection(APPROVALS).doc(uid).set({
      uid,
      oldPhone: user.phoneNumber ?? null,
      newPhone,
      proof: freshOldNumber ? "old_number" : "id",
      approvedAt: admin.firestore.Timestamp.now(),
      expiresAt,
      status: "approved",
    });
    return { success: true, data: { expiresAt: expiresAt.toDate().toISOString() } };
  }
);

export const completePhoneChange = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<unknown>
  ): Promise<ApiResponse<{ phoneNumber: string; sendingPausedUntil: string; sessionToken?: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const db = admin.firestore();
    const approvalRef = db.collection(APPROVALS).doc(uid);
    const approval = (await approvalRef.get()).data();
    if (!approval || approval.status !== "approved" || approval.expiresAt.toMillis() < Date.now()) {
      throw new https.HttpsError("failed-precondition", "Start the number change again.", {
        reason: "phone_change_expired",
      });
    }
    // 3. The app has verified the new number and attached it in Auth.
    const authUser = await admin.auth().getUser(uid);
    if (authUser.phoneNumber !== approval.newPhone) {
      throw new https.HttpsError("failed-precondition", "Verify the new number by SMS first.", {
        reason: "phone_change_unverified",
      });
    }

    const now = admin.firestore.Timestamp.now();
    const batch = db.batch();
    batch.update(db.collection("users").doc(uid), {
      phoneNumber: approval.newPhone,
      previousPhoneNumber: approval.oldPhone,
      phoneChangedAt: now,
      updatedAt: now,
    });
    batch.update(approvalRef, { status: "done", completedAt: now });
    batch.set(db.collection("users").doc(uid).collection("phoneHistory").doc(), {
      from: approval.oldPhone,
      to: approval.newPhone,
      proof: approval.proof,
      at: now,
    });
    await batch.commit();

    const sessionToken = await endSessions(uid, { keepCaller: true });
    const { phoneChangeCooldownDays } = await getRates();
    const until = new Date(now.toMillis() + phoneChangeCooldownDays * 24 * 60 * 60 * 1000);
    notifyUser(
      uid,
      "phone_changed",
      { key: "security.phone_changed", params: { phone: approval.newPhone, until } },
      { type: "phone_changed" }
    ).catch((err) => console.error("Failed to notify phone change:", err));

    return {
      success: true,
      data: { phoneNumber: approval.newPhone, sendingPausedUntil: until.toISOString(), sessionToken },
    };
  }
);
