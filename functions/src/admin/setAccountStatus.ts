/**
 * Freeze or unfreeze a customer account.
 *
 * Writes three things in one transaction: the status on the user doc (source
 * of truth), the `frozen` mirror on the wallet (what the ledger enforces on),
 * and the audit entry. Splitting any of them would allow a state where an
 * account looks frozen but can still spend, or is stopped with no record of
 * who stopped it.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, AccountStatus } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { resolveAccountStatus } from "../utils/accountStatus";

interface SetAccountStatusRequest {
  userId: string;
  /** Only reversible states. Closure runs through account deletion instead. */
  status: Extract<AccountStatus, "active" | "frozen">;
  reason: string;
}

interface SetAccountStatusResponse {
  userId: string;
  previousStatus: AccountStatus;
  status: AccountStatus;
  auditId: string;
}

export const adminSetAccountStatus = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<SetAccountStatusRequest>
  ): Promise<ApiResponse<SetAccountStatusResponse>> => {
    const actor = requireAdmin(request, "ops");
    requireRecentAdminAuth(request);

    const { userId, status } = request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof userId !== "string" || !userId.trim()) {
      throw new https.HttpsError("invalid-argument", "userId is required");
    }
    if (status !== "active" && status !== "frozen") {
      throw new https.HttpsError(
        "invalid-argument",
        "status must be 'active' or 'frozen'"
      );
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const walletRef = db.collection("wallets").doc(userId);

    try {
      const result = await db.runTransaction(async (tx) => {
        const [userSnap, walletSnap] = await Promise.all([
          tx.get(userRef),
          tx.get(walletRef),
        ]);

        if (!userSnap.exists) {
          throw new https.HttpsError("not-found", "User not found");
        }

        const previousStatus = resolveAccountStatus(userSnap.data());

        if (previousStatus === "closed") {
          throw new https.HttpsError(
            "failed-precondition",
            "Account is closed; it cannot be frozen or reactivated"
          );
        }

        const now = admin.firestore.Timestamp.now();
        const frozen = status === "frozen";

        tx.update(userRef, {
          accountStatus: status,
          frozenReason: frozen ? reason : admin.firestore.FieldValue.delete(),
          frozenBy: frozen ? actor.uid : admin.firestore.FieldValue.delete(),
          frozenAt: frozen ? now : admin.firestore.FieldValue.delete(),
          updatedAt: now,
        });

        // A user with no wallet yet (signed up, never funded) still gets the
        // status; the wallet mirror is written when the wallet appears.
        if (walletSnap.exists) {
          tx.update(walletRef, { frozen, updatedAt: now });
        }

        const auditId = stageAuditEntry(tx, {
          actor,
          action: frozen ? "user.freeze" : "user.unfreeze",
          target: { type: "user", id: userId },
          reason,
          before: { accountStatus: previousStatus },
          after: { accountStatus: status },
        });

        return { previousStatus, auditId };
      });

      console.log(
        `Account ${userId} set to ${status} by ${actor.uid} (${actor.email})`
      );

      return {
        success: true,
        message: status === "frozen" ? "Account frozen" : "Account reactivated",
        data: {
          userId,
          previousStatus: result.previousStatus,
          status,
          auditId: result.auditId,
        },
      };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error setting account status:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to set account status"
      );
    }
  }
);
