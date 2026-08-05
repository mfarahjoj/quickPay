import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, sanitizeString } from "../utils/validation";
import { isMerchantRole } from "../utils/roles";
import { ensureRoleRequest } from "./requestRole";
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

      if (!userDoc.exists) {
        throw new https.HttpsError(
          "failed-precondition",
          "Complete your profile before registering a business"
        );
      }

      if (isMerchantRole(userDoc.data()?.accountType)) {
        throw new https.HttpsError(
          "already-exists",
          "Already registered as merchant"
        );
      }

      // Business details only — the `merchant` role itself is granted by an
      // admin reviewing the role request below, never by this call. Writing
      // the profile here is not an escalation (clients may already write
      // their own merchantProfiles doc) and gives the reviewer something to
      // check against.
      await userRef.update({
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

      const roleRequest = await ensureRoleRequest(db, userId, "merchant", {
        businessName,
        note: businessType,
      });

      return {
        success: true,
        data: merchantProfile,
        message:
          roleRequest.status === "approved"
            ? "Merchant registration updated"
            : "Registration submitted — pending review",
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
