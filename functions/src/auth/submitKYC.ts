import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, sanitizeString } from "../utils/validation";
import { parseStorageRef } from "../utils/storagePaths";
import { ApiResponse, KycDocument } from "../types";

interface SubmitKYCRequest {
  idType: "national_id" | "passport" | "drivers_license";
  idNumber: string;
  frontPhotoUrl: string;
  backPhotoUrl?: string;
  selfieUrl: string;
}

const VALID_ID_TYPES = ["national_id", "passport", "drivers_license"];

export const submitKYC = https.onCall(
  async (
    request: https.CallableRequest<SubmitKYCRequest>
  ): Promise<ApiResponse> => {
    requireAuth(request);
    const userId = request.auth!.uid;
    const { idType, idNumber, frontPhotoUrl, backPhotoUrl, selfieUrl } =
      request.data;

    if (!VALID_ID_TYPES.includes(idType)) {
      throw new https.HttpsError("invalid-argument", "Invalid ID type");
    }

    if (!idNumber || idNumber.trim().length < 3) {
      throw new https.HttpsError(
        "invalid-argument",
        "ID number must be at least 3 characters"
      );
    }

    if (!frontPhotoUrl) {
      throw new https.HttpsError(
        "invalid-argument",
        "Front photo is required"
      );
    }

    if (!selfieUrl) {
      throw new https.HttpsError("invalid-argument", "Selfie is required");
    }

    try {
      const db = admin.firestore();

      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists) {
        throw new https.HttpsError("not-found", "User not found");
      }

      const currentStatus = userDoc.data()?.kycStatus;
      if (currentStatus === "verified") {
        throw new https.HttpsError(
          "failed-precondition",
          "KYC already verified"
        );
      }

      // Resolve object paths now, while we know which upload they came from.
      // Reviewers get signed URLs minted from these rather than the permanent
      // download links (see utils/storagePaths.ts).
      const frontPath = parseStorageRef(frontPhotoUrl)?.path;
      const backPath = backPhotoUrl ? parseStorageRef(backPhotoUrl)?.path : undefined;
      const selfiePath = parseStorageRef(selfieUrl)?.path;

      const kycDoc: KycDocument = {
        idType,
        idNumber: sanitizeString(idNumber),
        frontPhotoUrl,
        backPhotoUrl: backPhotoUrl || undefined,
        selfieUrl,
        ...(frontPath ? { frontPhotoPath: frontPath } : {}),
        ...(backPath ? { backPhotoPath: backPath } : {}),
        ...(selfiePath ? { selfiePath } : {}),
        status: "submitted",
        userId,
        submittedAt: admin.firestore.Timestamp.now(),
      };

      await db
        .collection("users")
        .doc(userId)
        .collection("kyc")
        .doc("latest")
        .set(kycDoc);

      await db.collection("users").doc(userId).update({
        kycStatus: "submitted",
        updatedAt: admin.firestore.Timestamp.now(),
      });

      console.log(`KYC submitted for user ${userId}`);
      return { success: true, message: "KYC submitted for review" };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error submitting KYC:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to submit KYC"
      );
    }
  }
);
