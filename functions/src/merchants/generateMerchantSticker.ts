import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { ApiResponse, MerchantProfile } from "../types";

interface StickerRequest {
  includeAmount?: boolean;
  amount?: number;
}

interface StickerResponse {
  qrData: string;
  merchantName: string;
  merchantId: string;
  businessAddress: string;
}

export const generateMerchantSticker = https.onCall(
  async (
    request: https.CallableRequest<StickerRequest>
  ): Promise<ApiResponse<StickerResponse>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    try {
      const db = admin.firestore();

      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists || userDoc.data()?.accountType !== "merchant") {
        throw new https.HttpsError(
          "permission-denied",
          "Only merchants can generate stickers"
        );
      }

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

      const profile = profileDoc.data() as MerchantProfile;
      const { includeAmount, amount } = request.data;

      const qrPayload: Record<string, any> = {
        type: "quickpay_merchant",
        merchantId: userId,
        merchantName: profile.businessName,
        address: profile.businessAddress,
      };

      if (includeAmount && amount && amount > 0) {
        qrPayload.amount = amount;
      }

      const qrData = JSON.stringify(qrPayload);

      return {
        success: true,
        data: {
          qrData,
          merchantName: profile.businessName,
          merchantId: userId,
          businessAddress: profile.businessAddress,
        },
      };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error generating merchant sticker:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to generate sticker"
      );
    }
  }
);
