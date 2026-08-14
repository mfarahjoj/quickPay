import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { decrypt } from "../utils/encryption";
import { ENCRYPTION_KEY } from "../config/secrets";
import { ApiResponse, CustomerToken, User } from "../types";

interface ScanTokenRequest {
  tokenData: string;
}

interface ScanTokenResponse {
  valid: boolean;
  tokenId: string;
  customerName: string;
  customerId: string;
}

export const scanCustomerToken = https.onCall(
  { enforceAppCheck: true, secrets: [ENCRYPTION_KEY] },
  async (
    request: https.CallableRequest<ScanTokenRequest>
  ): Promise<ApiResponse<ScanTokenResponse>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const db = admin.firestore();

    const merchantDoc = await db.collection("users").doc(merchantId).get();
    if (!merchantDoc.exists) {
      throw new https.HttpsError("not-found", "Merchant not found");
    }

    const merchant = merchantDoc.data() as User;
    if (
      merchant.accountType !== "merchant" &&
      merchant.accountType !== "agent_merchant"
    ) {
      throw new https.HttpsError(
        "permission-denied",
        "Only merchants can scan customer tokens"
      );
    }

    const { tokenData } = request.data;
    if (!tokenData) {
      throw new https.HttpsError(
        "invalid-argument",
        "Token data is required"
      );
    }

    let parsed: { id: string; customerId: string; expiresAt: string };
    try {
      const decrypted = decrypt(tokenData);
      parsed = JSON.parse(decrypted);
    } catch {
      throw new https.HttpsError(
        "invalid-argument",
        "Invalid or corrupted QR code"
      );
    }

    if (parsed.customerId === merchantId) {
      throw new https.HttpsError(
        "permission-denied",
        "Cannot scan your own token"
      );
    }

    const tokenDoc = await db
      .collection("customerTokens")
      .doc(parsed.id)
      .get();

    if (!tokenDoc.exists) {
      throw new https.HttpsError("not-found", "Token not found");
    }

    const token = tokenDoc.data() as CustomerToken;

    if (token.status !== "active") {
      throw new https.HttpsError(
        "failed-precondition",
        `Token is ${token.status}`
      );
    }

    if (token.expiresAt.toDate() < new Date()) {
      await tokenDoc.ref.update({ status: "expired" });
      throw new https.HttpsError(
        "failed-precondition",
        "Token has expired"
      );
    }

    // Mark as scanned
    await tokenDoc.ref.update({
      status: "scanned",
      scannedBy: merchantId,
      scannedAt: admin.firestore.Timestamp.now(),
    });

    const customerDoc = await db
      .collection("users")
      .doc(token.customerId)
      .get();
    const customer = customerDoc.data() as User;

    return {
      success: true,
      data: {
        valid: true,
        tokenId: parsed.id,
        customerName: customer.fullName,
        customerId: token.customerId,
      },
    };
  }
);
