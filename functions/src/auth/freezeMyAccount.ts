/**
 * Freeze my account — the holder stops money leaving their own wallet.
 *
 * For a payment they don't recognise, or a phone they've lost and signed in
 * from elsewhere. It does exactly what an ops freeze does (user status, the
 * wallet's `frozen` mirror the ledger enforces, in one transaction), so
 * nothing can be spent, sent or cashed out, while money sent to them still
 * arrives. Only support can reverse it, with adminSetAccountStatus, after
 * checking it really is the owner asking. A thief who can unfreeze is no
 * protection at all.
 *
 * Takes the PIN: whoever holds an unlocked phone shouldn't be able to lock
 * the owner out on a whim.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { endSessions } from "./sessions";
import { ApiResponse } from "../types";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "./validatePin";
import { resolveAccountStatus } from "../utils/accountStatus";
import { notifyUser } from "../utils/notifications";

export const freezeMyAccount = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ pin: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const pin = request.data?.pin;
    if (typeof pin !== "string" || !pin) {
      throw new https.HttpsError("invalid-argument", "PIN is required");
    }
    if (!(await verifyUserPin(uid, pin))) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const walletRef = db.collection("wallets").doc(uid);

    const changed = await db.runTransaction(async (tx) => {
      const [userSnap, walletSnap] = await Promise.all([tx.get(userRef), tx.get(walletRef)]);
      if (!userSnap.exists) throw new https.HttpsError("not-found", "Account not found");
      const status = resolveAccountStatus(userSnap.data());
      if (status === "closed") {
        throw new https.HttpsError("failed-precondition", "This account is closed");
      }
      // Already frozen (by ops or earlier): nothing to do, and not an error.
      if (status === "frozen") return false;

      const now = admin.firestore.Timestamp.now();
      tx.update(userRef, {
        accountStatus: "frozen",
        frozenReason: "Frozen by the account holder",
        frozenBy: uid,
        frozenAt: now,
        selfFrozen: true,
        updatedAt: now,
      });
      if (walletSnap.exists) tx.update(walletRef, { frozen: true, updatedAt: now });
      return true;
    });

    // Whoever has the lost phone is signed out too (review A5).
    const sessionToken = await endSessions(uid, { keepCaller: true });

    if (changed) {
      notifyUser(
        uid,
        "account_frozen",
        "Account frozen",
        "You froze your Zapp Pay account. No money can leave it until support unfreezes it.",
        { type: "account_frozen" }
      ).catch((err) => console.error("Failed to notify self-freeze:", err));
    }
    return {
      success: true,
      message: changed ? "Account frozen" : "Account already frozen",
      data: { sessionToken },
    };
  }
);
