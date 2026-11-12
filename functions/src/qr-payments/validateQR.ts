import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { parseQRData } from "../utils/encryption";
import { parseEmvQRPayload } from "../utils/emvqr";
import { ApiResponse, QRCode } from "../types";

interface ValidateQRRequest {
  qrData: string;
}

interface ValidateQRResponse {
  valid: boolean;
  qrCodeId?: string;
  merchantId?: string;
  merchantName?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  reason?: string;
  /** When true the QR is a permanent merchant sticker — the customer must enter an amount. */
  isMerchantSticker?: boolean;
}

/**
 * Callable function to validate a QR code before payment
 */
export const validateQRCode = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ValidateQRRequest>
  ): Promise<ApiResponse<ValidateQRResponse>> => {
    // Validate authentication
    requireAuth(request);
    const customerId = request.auth!.uid;

    const { qrData } = request.data;

    if (!qrData) {
      throw new https.HttpsError(
        "invalid-argument",
        "QR data is required"
      );
    }

    try {
      const db = admin.firestore();

      // ── Handle permanent merchant sticker QR ──────────────────
      // Format: JSON with { type: "quickpay_merchant", merchantId, ... }
      let stickerPayload: any = null;
      try {
        const parsed = JSON.parse(qrData);
        if (parsed && parsed.type === "quickpay_merchant" && parsed.merchantId) {
          stickerPayload = parsed;
        }
      } catch {
        // Not JSON — fall through to EMV / encrypted check
      }

      if (stickerPayload) {
        const stickerMerchantId = stickerPayload.merchantId as string;

        if (stickerMerchantId === customerId) {
          return {
            success: true,
            data: { valid: false, reason: "Cannot pay yourself" },
          };
        }

        const merchantDoc = await db.collection("users").doc(stickerMerchantId).get();
        if (!merchantDoc.exists) {
          return {
            success: true,
            data: { valid: false, reason: "Merchant not found" },
          };
        }
        const merchantData = merchantDoc.data();
        if (merchantData?.accountType !== "merchant" && merchantData?.accountType !== "agent_merchant") {
          return {
            success: true,
            data: { valid: false, reason: "Invalid merchant" },
          };
        }

        const profileDoc = await db
          .collection("merchantProfiles")
          .doc(stickerMerchantId)
          .get();
        const merchantName =
          (profileDoc.exists && (profileDoc.data() as any).businessName) ||
          merchantData?.fullName ||
          "Merchant";

        return {
          success: true,
          data: {
            valid: true,
            merchantId: stickerMerchantId,
            merchantName,
            isMerchantSticker: true,
            amount: stickerPayload.amount ?? undefined,
            currency: "USD",
          },
        };
      }

      // ── Handle session-based QR codes (EMV / encrypted) ──────
      let qrCodeId: string | undefined;
      let merchantId: string | undefined;

      if (qrData.startsWith("00")) {
        const emvParsed = parseEmvQRPayload(qrData);
        if (emvParsed && emvParsed.qrCodeId) {
          qrCodeId = emvParsed.qrCodeId;
          merchantId = emvParsed.merchantId;
        }
      }

      if (!qrCodeId || !merchantId) {
        const parsedData = parseQRData(qrData);
        if (!parsedData) {
          return {
            success: true,
            data: {
              valid: false,
              reason: "Invalid QR code format",
            },
          };
        }
        qrCodeId = parsedData.id;
        merchantId = parsedData.merchantId;
      }

      const qrCodeDoc = await db.collection("qrCodes").doc(qrCodeId).get();

      if (!qrCodeDoc.exists) {
        return {
          success: true,
          data: {
            valid: false,
            reason: "QR code not found",
          },
        };
      }

      const qrCode = qrCodeDoc.data() as QRCode;

      // Check if QR code is still active
      if (qrCode.status !== "active") {
        return {
          success: true,
          data: {
            valid: false,
            reason: `QR code is ${qrCode.status}`,
          },
        };
      }

      // Check if QR code has expired
      const now = new Date();
      const expiresAt = qrCode.expiresAt.toDate();
      if (now > expiresAt) {
        // Mark as expired
        await db.collection("qrCodes").doc(qrCodeId).update({
          status: "expired",
        });

        return {
          success: true,
          data: {
            valid: false,
            reason: "QR code has expired",
          },
        };
      }

      // Verify merchant exists
      const merchantDoc = await db.collection("users").doc(merchantId).get();
      if (!merchantDoc.exists) {
        return {
          success: true,
          data: {
            valid: false,
            reason: "Merchant not found",
          },
        };
      }

      // Don't allow self-payment
      if (merchantId === customerId) {
        return {
          success: true,
          data: {
            valid: false,
            reason: "Cannot pay yourself",
          },
        };
      }

      const merchantData = merchantDoc.data();
      const sessionMerchantName = merchantData?.fullName || "Merchant";

      return {
        success: true,
        data: {
          valid: true,
          qrCodeId,
          merchantId,
          merchantName: sessionMerchantName,
          amount: qrCode.amount,
          currency: qrCode.currency,
          ...(qrCode.reference ? { reference: qrCode.reference } : {}),
        },
      };
    } catch (error: any) {
      console.error("Error validating QR code:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to validate QR code"
      );
    }
  }
);
