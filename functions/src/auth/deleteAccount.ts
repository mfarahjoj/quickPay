import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "./validatePin";
import { ApiResponse } from "../types";
import {
  DeletionBlocker,
  eraseAccount,
  findDeletionBlockers,
} from "./accountDeletion";

interface DeleteAccountRequest {
  pin: string;
  reason?: string;
}

const BLOCKER_MESSAGES: Record<DeletionBlocker, string> = {
  frozen: "This account is frozen. Please contact support.",
  balance:
    "Please withdraw your remaining balance before deleting your account",
  pending_cash_out:
    "You have a cash-out in progress. Finish or cancel it, then try again.",
  pending_topup:
    "You have a top-up in progress. Finish or cancel it, then try again.",
  pending_remittance:
    "You have a transfer in progress. Wait for it to finish, then try again.",
  pending_payment:
    "You have a payment in progress. Wait for it to finish, then try again.",
};

/**
 * Permanently deletes the caller's account and personal data.
 *
 * (The name predates this: it used to only flag the account and promise
 * deletion within 30 days, which nothing carried out. Kept so apps already in
 * the stores keep working.) Money records are retained without identifying
 * data; see accountDeletion.ts.
 */
export const requestAccountDeletion = https.onCall(
  async (
    request: https.CallableRequest<DeleteAccountRequest>
  ): Promise<ApiResponse> => {
    requireAuth(request);
    const userId = request.auth!.uid;
    const { pin, reason } = request.data ?? ({} as DeleteAccountRequest);

    const db = admin.firestore();

    try {
      const userSnap = await db.collection("users").doc(userId).get();
      const user = userSnap.data();

      // A tombstone means an earlier attempt erased everything but could not
      // delete the login. The PIN is gone with it, and the caller has just
      // proved who they are by signing in, so finish the job.
      const resuming = user?.deletedAt != null;

      if (!resuming) {
        if (!pin || pin.length !== 6) {
          throw new https.HttpsError(
            "invalid-argument",
            "PIN is required to delete account"
          );
        }
        // Shared lockout-aware verification (throws resource-exhausted when locked)
        const isValid = await verifyUserPin(userId, pin);
        if (!isValid) {
          throw new https.HttpsError("permission-denied", "Invalid PIN");
        }

        const walletSnap = await db.collection("wallets").doc(userId).get();
        const balance = (walletSnap.data()?.balance as number | undefined) ?? 0;
        const blockers = await findDeletionBlockers(db, userId, user, balance);
        if (blockers.length > 0) {
          throw new https.HttpsError(
            "failed-precondition",
            BLOCKER_MESSAGES[blockers[0]],
            { blockers }
          );
        }
      }

      const bucket = admin.storage().bucket();
      await eraseAccount(
        {
          db,
          deleteFiles: async (prefix) => {
            await bucket.deleteFiles({ prefix });
          },
          deleteAuthUser: async (uid) => {
            try {
              await admin.auth().deleteUser(uid);
            } catch (e: any) {
              if (e?.code !== "auth/user-not-found") throw e;
            }
          },
          now: () => admin.firestore.Timestamp.now(),
        },
        userId
      );

      // The reason is for product feedback, not identity: log it without the uid.
      console.log(`Account deleted${reason ? ` (reason: ${reason})` : ""}`);
      return {
        success: true,
        message: "Your account and personal data have been deleted.",
      };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      if (error?.message === "balance-changed") {
        throw new https.HttpsError(
          "failed-precondition",
          BLOCKER_MESSAGES.balance
        );
      }
      console.error("Error deleting account:", error);
      throw new https.HttpsError(
        "internal",
        "Failed to delete account. Please try again."
      );
    }
  }
);
