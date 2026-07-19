import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { ApiResponse } from "../types";

interface ReferralStatsResponse {
  code: string;
  count: number;
  earnedCents: number;
}

export const getReferralStats = https.onCall(
  async (request: https.CallableRequest): Promise<ApiResponse<ReferralStatsResponse>> => {
    requireAuth(request);
    const uid = request.auth!.uid;

    try {
      const db = admin.firestore();
      const userDoc = await db.collection("users").doc(uid).get();

      if (!userDoc.exists) {
        throw new https.HttpsError("not-found", "User not found");
      }

      const data = userDoc.data()!;
      const code: string = data.referralCode ?? "";
      const count: number = data.referralCount ?? 0;
      const earnedCents: number = count * 100;

      return { success: true, data: { code, count, earnedCents } };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("getReferralStats error:", error);
      throw new https.HttpsError("internal", error.message || "Failed to get referral stats");
    }
  }
);
