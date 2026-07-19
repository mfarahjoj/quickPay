import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, centsToDollars } from "../utils/validation";
import { ApiResponse } from "../types";

interface AccountLimitsResponse {
  kycStatus: string;
  dailyLimit: number;
  monthlyLimit: number;
  dailyUsed: number;
  monthlyUsed: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  perTransactionLimit: number;
}

const LIMITS_BY_KYC: Record<
  string,
  { daily: number; monthly: number; perTransaction: number }
> = {
  pending: { daily: 50000, monthly: 500000, perTransaction: 10000 },
  submitted: { daily: 50000, monthly: 500000, perTransaction: 10000 },
  verified: { daily: 500000, monthly: 5000000, perTransaction: 100000 },
  rejected: { daily: 20000, monthly: 200000, perTransaction: 5000 },
};

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

      const kycStatus = userDoc.data()?.kycStatus ?? "pending";
      const limits = LIMITS_BY_KYC[kycStatus] ?? LIMITS_BY_KYC.pending;

      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const dailyQuery = await db
        .collection("transactions")
        .where("fromUserId", "==", userId)
        .where("status", "==", "completed")
        .where(
          "createdAt",
          ">=",
          admin.firestore.Timestamp.fromDate(startOfDay)
        )
        .get();

      const monthlyQuery = await db
        .collection("transactions")
        .where("fromUserId", "==", userId)
        .where("status", "==", "completed")
        .where(
          "createdAt",
          ">=",
          admin.firestore.Timestamp.fromDate(startOfMonth)
        )
        .get();

      let dailyUsed = 0;
      dailyQuery.forEach((doc) => {
        dailyUsed += doc.data().amount ?? 0;
      });

      let monthlyUsed = 0;
      monthlyQuery.forEach((doc) => {
        monthlyUsed += doc.data().amount ?? 0;
      });

      return {
        success: true,
        data: {
          kycStatus,
          dailyLimit: centsToDollars(limits.daily),
          monthlyLimit: centsToDollars(limits.monthly),
          dailyUsed: centsToDollars(dailyUsed),
          monthlyUsed: centsToDollars(monthlyUsed),
          dailyRemaining: centsToDollars(
            Math.max(0, limits.daily - dailyUsed)
          ),
          monthlyRemaining: centsToDollars(
            Math.max(0, limits.monthly - monthlyUsed)
          ),
          perTransactionLimit: centsToDollars(limits.perTransaction),
        },
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
