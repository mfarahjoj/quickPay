import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertAccountActive } from "../utils/accountStatus";
import { requireAuth, validateAmount, validateCurrency } from "../utils/validation";
import { generateSecureId } from "../utils/encryption";
import { generateEmvQRPayload } from "../utils/emvqr";
import { getRates, computePaymentFee } from "../config/rates";
import { ApiResponse, QRCode, GenerateQRResponse } from "../types";

interface GenerateQRRequest {
  amount: number; // In cents
  currency: string;
  reference?: string;
}

const QR_CODE_EXPIRY_MINUTES = 10;

/**
 * EMVCo caps tag 59 (merchant name) at 25 chars. TLV lengths are two digits,
 * so an over-long name doesn't just truncate — it corrupts every tag after it.
 */
const EMV_NAME_MAX = 25;

/**
 * Callable function to generate a QR code for merchant payment.
 *
 * The rendered payload is the EMV/SOMQR string, which carries only the
 * merchantId and qrCodeId — everything that decides the payment (amount,
 * status, expiry) is read server-side from the qrCodes doc, and the code is
 * single-use. That keeps the payload short, which matters: a denser QR is
 * measurably harder to scan off a phone screen in direct sunlight.
 */
export const generateQRCode = https.onCall(
  { enforceAppCheck: true },
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
      const [userDoc, profileDoc] = await Promise.all([
        db.collection("users").doc(merchantId).get(),
        db.collection("merchantProfiles").doc(merchantId).get(),
      ]);
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

      // The customer pays the gross; the merchant absorbs the platform fee and
      // is credited the net. Return both so the merchant sees what will
      // actually land in their wallet *before* they show the code.
      const { paymentFeeRate } = await getRates();
      const feeCents = computePaymentFee(amount, paymentFeeRate);
      const netCents = amount - feeCents;

      // The business name is what the customer sees when confirming, so prefer
      // the shop name over the owner's personal name.
      const merchantName =
        (profileDoc.exists && (profileDoc.data() as any)?.businessName) ||
        userData?.fullName ||
        "Zapp Pay Merchant";

      const emvQrData = generateEmvQRPayload({
        pointOfInitiation: "12",
        merchantId,
        qrCodeId,
        merchantCategoryCode: userData?.merchantCategoryCode || "5999",
        currencyCode: "840",
        amount: amount / 100,
        countryCode: "SO",
        merchantName: merchantName.slice(0, EMV_NAME_MAX),
        merchantCity: "Hargeisa",
      });

      // Create QR code document
      const qrCode: QRCode = {
        merchantId,
        amount,
        currency,
        status: "active",
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        createdAt: admin.firestore.Timestamp.now(),
        emvQrData,
        ...(reference ? { reference } : {}),
      };

      await db.collection("qrCodes").doc(qrCodeId).set(qrCode);

      console.log(`Generated QR code ${qrCodeId} for merchant ${merchantId}`);

      return {
        success: true,
        data: {
          qrCodeId,
          // `qrData` is the payload to render. Kept alongside `emvQrData` so
          // older clients reading either field get the same scannable string.
          qrData: emvQrData,
          emvQrData,
          expiresAt,
          feeCents,
          netCents,
          merchantName,
        },
      };
    } catch (error: any) {
      // Re-throw typed errors untouched — collapsing them into "internal"
      // hides the actual cause from the merchant and from support.
      if (error instanceof https.HttpsError) throw error;

      console.error("Error generating QR code:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to generate QR code"
      );
    }
  }
);
