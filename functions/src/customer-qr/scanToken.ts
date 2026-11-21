import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { mayRaise } from "./counterCashOut";
import { requireMerchantActor } from "../staff/access";
import { decrypt } from "../utils/encryption";
import { ENCRYPTION_KEY, PIN_PEPPER } from "../config/secrets";
import { ApiResponse, CustomerToken, User } from "../types";

interface ScanTokenRequest {
  tokenData: string;
  /** A staff member scanning for this shop (STAFF_ACCESS.md). Omitted by the shop itself. */
  merchantId?: string;
}

interface ScanTokenResponse {
  valid: boolean;
  tokenId: string;
  customerName: string;
  customerId: string;
}

export const scanCustomerToken = https.onCall(
  { enforceAppCheck: true, secrets: [ENCRYPTION_KEY, PIN_PEPPER] },
  async (
    request: https.CallableRequest<ScanTokenRequest>
  ): Promise<ApiResponse<ScanTokenResponse>> => {
    const actor = await requireMerchantActor(request, request.data?.merchantId, "charge");
    const merchantId = actor.merchantUid;
    const staff = actor.role !== "owner";

    const db = admin.firestore();

    const merchantDoc = await db.collection("users").doc(merchantId).get();
    if (!merchantDoc.exists) {
      throw new https.HttpsError("not-found", "Merchant not found");
    }

    const merchant = merchantDoc.data() as User;
    // Shops scan to charge; agents (topup_agent too) scan to pay out cash.
    // createPaymentRequest checks which of the two each account may raise.
    // Staff charge for a shop; paying out cash from float stays the agent's own.
    if (staff ? !mayRaise(merchant.accountType, "payment") : !mayRaise(merchant.accountType, "payment") && !mayRaise(merchant.accountType, "cash_out")) {
      throw new https.HttpsError(
        "permission-denied",
        "Only merchants and agents can scan customer tokens"
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

    if (parsed.customerId === merchantId || parsed.customerId === actor.actorUid) {
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
      ...(staff ? { scannedByActor: actor.actorUid } : {}),
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
