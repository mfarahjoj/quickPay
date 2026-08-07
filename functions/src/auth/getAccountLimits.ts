import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { limitsFor } from "../config/limits";
import { describeLimits, getSpendUsage } from "../utils/limits";
import { ApiResponse } from "../types";

interface AccountLimitsResponse {
  kycStatus: string;
  tier: string;
  dailyLimit: number;
  monthlyLimit: number;
  dailyUsed: number;
  monthlyUsed: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  perTransactionLimit: number;
}

/**
 * What this account may spend, and what it has spent.
 *
 * Reads the same `config/limits` table and the same spend definition that
 * `enforceTransactionLimits` applies, so the figures shown to a customer
 * cannot drift from the ones enforced — they previously did, with a rejected
 * account told $50 and allowed $100.
 */
export const getAccountLimits = https.onCall(
  async (
    request: https.CallableRequest
  ): Promise<ApiResponse<AccountLimitsResponse>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    try {
      const db = admin.firestore();
      const userDoc = await db.collection("users").doc(userId).get();

      if (!userDoc.exists) {
        throw new https.HttpsError("not-found", "User not found");
      }

      const userData = userDoc.data() ?? {};
      const kycStatus = userData.kycStatus ?? "pending";

      const [{ tier, limits }, usage] = await Promise.all([
        limitsFor(kycStatus, userData.accountType),
        getSpendUsage(userId),
      ]);

      return {
        success: true,
        data: {
          kycStatus,
          tier,
          ...describeLimits(limits, usage),
        } as AccountLimitsResponse,
      };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error getting account limits:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to get account limits"
      );
    }
  }
);
