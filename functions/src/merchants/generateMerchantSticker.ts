import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
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

/**
 * The shop's own QR ("My QR"), where the customer types the amount. Shared
 * with the counter display (counterDisplay/state.ts), so the code on the
 * tablet is byte-for-byte the one on the phone.
 */
export function buildStickerPayload(
  merchantId: string,
  merchantName: string,
  businessAddress: string,
  amount?: number
): string {
  const qrPayload: Record<string, any> = {
    type: "quickpay_merchant",
    merchantId,
    merchantName,
    address: businessAddress,
  };
  if (amount && amount > 0) qrPayload.amount = amount;
  return JSON.stringify(qrPayload);
}

export const generateMerchantSticker = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<StickerRequest>
  ): Promise<ApiResponse<StickerResponse>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    try {
      const db = admin.firestore();

      const [userDoc, profileDoc] = await Promise.all([
        db.collection("users").doc(userId).get(),
        db.collection("merchantProfiles").doc(userId).get(),
      ]);

      const userData = userDoc.data();
      // agent_merchant runs a shop too — locking it out here left dual-role
      // pilot accounts with no counter code at all.
      if (
        !userDoc.exists ||
        (userData?.accountType !== "merchant" &&
          userData?.accountType !== "agent_merchant")
      ) {
        throw new https.HttpsError(
          "permission-denied",
          "Only merchants can generate stickers"
        );
      }

      assertAccountActive(userData);

      const profile = profileDoc.exists
        ? (profileDoc.data() as MerchantProfile)
        : null;
      // A missing profile doc shouldn't cost a merchant their counter code —
      // fall back to the account name rather than failing the sale.
      const merchantName =
        profile?.businessName || userData?.fullName || "Zapp Pay Merchant";
      const businessAddress = profile?.businessAddress || "Hargeisa";

      const { includeAmount, amount } = request.data;

      const qrData = buildStickerPayload(
        userId,
        merchantName,
        businessAddress,
        includeAmount && amount && amount > 0 ? amount : undefined
      );

      return {
        success: true,
        data: {
          qrData,
          merchantName,
          merchantId: userId,
          businessAddress,
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
