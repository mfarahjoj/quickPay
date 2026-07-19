import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, sanitizeString } from "../utils/validation";
import { ApiResponse, MerchantProfile } from "../types";

interface RegisterMerchantRequest {
  businessName: string;
  businessType: string;
  businessAddress: string;
  settlementPreference: "zaad" | "edahab";
  zaadAccount?: string;
  edahabAccount?: string;
  merchantCategoryCode?: string;
}

export const registerMerchant = https.onCall(
  async (
    request: https.CallableRequest<RegisterMerchantRequest>
  ): Promise<ApiResponse<MerchantProfile>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    const {
      businessName,
      businessType,
      businessAddress,
      settlementPreference,
      zaadAccount,
      edahabAccount,
      merchantCategoryCode,
    } = request.data;

    if (!businessName || typeof businessName !== "string" || !businessName.trim()) {
      throw new https.HttpsError(
        "invalid-argument",
        "Business name is required"
      );
    }

    if (!businessType || typeof businessType !== "string" || !businessType.trim()) {
      throw new https.HttpsError(
        "invalid-argument",
        "Business type is required"
      );
    }

    try {
      const db = admin.firestore();
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();

      if (userDoc.exists && userDoc.data()?.accountType === "merchant") {
        throw new https.HttpsError(
          "already-exists",
          "Already registered as merchant"
        );
      }

      await userRef.update({
        accountType: "merchant",
        merchantCategoryCode: merchantCategoryCode || "",
        updatedAt: admin.firestore.Timestamp.now(),
      });

      const merchantProfile: MerchantProfile = {
        businessName: sanitizeString(businessName),
        businessType: sanitizeString(businessType),
        businessAddress: sanitizeString(businessAddress || ""),
        settlementPreference,
        zaadAccount: zaadAccount || undefined,
        edahabAccount: edahabAccount || undefined,
        minimumSettlementAmount: 1000,
      };

      await db
        .collection("merchantProfiles")
        .doc(userId)
        .set(merchantProfile);

      return {
        success: true,
        data: merchantProfile,
        message: "Merchant registration successful",
      };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error registering merchant:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to register merchant"
      );
    }
  }
);
