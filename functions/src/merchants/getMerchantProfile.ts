import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { ApiResponse, MerchantProfile } from "../types";

export const getMerchantProfile = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest
  ): Promise<ApiResponse<MerchantProfile>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    try {
      const db = admin.firestore();
      const profileDoc = await db
        .collection("merchantProfiles")
        .doc(userId)
        .get();

      if (!profileDoc.exists) {
        throw new https.HttpsError(
          "not-found",
          "Merchant profile not found"
        );
      }

      return {
        success: true,
        data: profileDoc.data() as MerchantProfile,
      };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error getting merchant profile:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to get merchant profile"
      );
    }
  }
);
