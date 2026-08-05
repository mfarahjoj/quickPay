import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertAccountActive } from "../utils/accountStatus";
import { requireAuth, validateAmount, validateCurrency } from "../utils/validation";
import { generateQRData, generateSecureId } from "../utils/encryption";
import { generateEmvQRPayload } from "../utils/emvqr";
import { ApiResponse, QRCode, GenerateQRResponse } from "../types";

interface GenerateQRRequest {
  amount: number; // In cents
  currency: string;
  reference?: string;
}

const QR_CODE_EXPIRY_MINUTES = 10;

/**
 * Callable function to generate a QR code for merchant payment
 */
export const generateQRCode = https.onCall(
  async (
    request: https.CallableRequest<GenerateQRRequest>
  ): Promise<ApiResponse<GenerateQRResponse>> => {
    // Validate authentication
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const { amount, currency, reference } = request.data;

    // Validate inputs
    if (!validateAmount(amount)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive integer (in cents)"
      );
    }

    if (!validateCurrency(currency)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Invalid currency. Supported: USD, SLS"
      );
    }

    try {
      const db = admin.firestore();

      // Verify user is a merchant
      const userDoc = await db.collection("users").doc(merchantId).get();
      if (!userDoc.exists) {
        throw new https.HttpsError("not-found", "User not found");
      }

      const userData = userDoc.data();
      if (userData?.accountType !== "merchant" && userData?.accountType !== "agent_merchant") {
        throw new https.HttpsError(
          "permission-denied",
          "Only merchant accounts can generate QR codes"
        );
      }
      // Stop a frozen merchant issuing new payment codes to collect against.
      assertAccountActive(userData);

      // Generate QR code ID
      const qrCodeId = generateSecureId(16);

      // Calculate expiry time
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + QR_CODE_EXPIRY_MINUTES);

      // Create QR code document
      const qrCode: QRCode = {
        merchantId,
        amount,
        currency,
        status: "active",
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        createdAt: admin.firestore.Timestamp.now(),
        ...(reference ? { reference } : {}),
      };

      await db.collection("qrCodes").doc(qrCodeId).set(qrCode);

      // Generate encrypted QR data
      const qrData = generateQRData(qrCodeId, merchantId, amount, expiresAt);

      const merchantName = userData?.fullName || "QuickPay Merchant";
      const emvQrData = generateEmvQRPayload({
        pointOfInitiation: "12",
        merchantId,
        qrCodeId,
        merchantCategoryCode: userData?.merchantCategoryCode || "5999",
        currencyCode: "840",
        amount: amount / 100,
        countryCode: "SO",
        merchantName,
        merchantCity: "Hargeisa",
      });

      await db.collection("qrCodes").doc(qrCodeId).update({ emvQrData });

      console.log(`Generated QR code ${qrCodeId} for merchant ${merchantId}`);

      return {
        success: true,
        data: {
          qrCodeId,
          qrData,
          emvQrData,
          expiresAt,
        },
      };
    } catch (error: any) {
      console.error("Error generating QR code:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to generate QR code"
      );
    }
  }
);
