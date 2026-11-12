/**
 * Rename a merchant or agent — the only way a business name changes.
 *
 * Merchants can't rename themselves (utils/nameLock.ts): the name is what a
 * customer checks before paying, so a change is something ops confirms
 * against the shop's papers first. This writes the user's `fullName`, the
 * profile's `businessName` and the audit entry in one transaction, so the two
 * names customers see can't disagree and no rename goes unrecorded.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { sanitizeString } from "../utils/validation";
import { isNameLocked } from "../utils/nameLock";

interface RenameMerchantRequest {
  userId: string;
  name: string;
  reason: string;
}

interface RenameMerchantResponse {
  userId: string;
  previousName: string | null;
  name: string;
  auditId: string;
}

export const adminRenameMerchant = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<RenameMerchantRequest>
  ): Promise<ApiResponse<RenameMerchantResponse>> => {
    const actor = requireAdmin(request, "ops");
    requireRecentAdminAuth(request);

    const { userId } = request.data ?? {};
    const reason = requireReason(request.data?.reason);
    const name = sanitizeString(request.data?.name ?? "");

    if (typeof userId !== "string" || !userId.trim()) {
      throw new https.HttpsError("invalid-argument", "userId is required");
    }
    if (name.length < 2 || name.length > 80) {
      throw new https.HttpsError(
        "invalid-argument",
        "name must be 2 to 80 characters"
      );
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const profileRef = db.collection("merchantProfiles").doc(userId);

    try {
      const result = await db.runTransaction(async (tx) => {
        const [userSnap, profileSnap] = await Promise.all([
          tx.get(userRef),
          tx.get(profileRef),
        ]);

        if (!userSnap.exists) {
          throw new https.HttpsError("not-found", "User not found");
        }
        const user = userSnap.data()!;
        if (!isNameLocked(user.accountType)) {
          throw new https.HttpsError(
            "failed-precondition",
            "Only merchant and agent names are changed here; customers rename themselves"
          );
        }

        const previousName: string | null =
          (profileSnap.exists && (profileSnap.data()?.businessName as string)) ||
          (user.fullName as string) ||
          null;
        const now = admin.firestore.Timestamp.now();

        tx.update(userRef, { fullName: name, updatedAt: now });
        // Agents without a shop have no profile; the user doc is their name.
        if (profileSnap.exists) {
          tx.update(profileRef, { businessName: name });
        }

        const auditId = stageAuditEntry(tx, {
          actor,
          action: "merchant.rename",
          target: { type: "user", id: userId },
          reason,
          before: { name: previousName },
          after: { name },
        });

        return { previousName, auditId };
      });

      return {
        success: true,
        message: "Name changed",
        data: { userId, previousName: result.previousName, name, auditId: result.auditId },
      };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error renaming merchant:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to rename merchant"
      );
    }
  }
);
