import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertAccountActive } from "../utils/accountStatus";
import { enforcePerTransactionLimit } from "../utils/limits";
import {
  requireAuth,
  validateAmount,
  validateCurrency,
} from "../utils/validation";
import { sendPushNotification } from "../utils/notifications";
import { getRates } from "../config/rates";
import {
  ApiResponse,
  CustomerToken,
  MerchantPaymentRequest,
  PaymentRequestStatus,
  User,
} from "../types";
import { requestExpiryMillis } from "./requestExpiry";

/**
 * How long after the scan the charge may be raised. Matches the customer
 * code's own two-minute life: the customer showed it in person, and a charge
 * raised after they have walked away is not one they are there to check.
 */
const MAX_SCAN_AGE_MS = 2 * 60 * 1000;

interface ChargeResult {
  requestId: string;
  amount: number;
  status: PaymentRequestStatus;
  /** ISO time the customer can no longer approve. */
  expiresAt: string;
  /** Seconds left at the time of the reply, for a countdown immune to clock skew. */
  expiresInSeconds: number;
}

function assertChargeable(token: CustomerToken, merchantId: string): void {
  if (token.status !== "scanned") {
    throw new https.HttpsError(
      "failed-precondition",
      "Token must be in scanned state"
    );
  }
  if (token.scannedBy !== merchantId) {
    throw new https.HttpsError(
      "permission-denied",
      "Token was scanned by a different merchant"
    );
  }
  const scannedAt = token.scannedAt?.toMillis();
  if (!scannedAt || Date.now() - scannedAt > MAX_SCAN_AGE_MS) {
    throw new https.HttpsError(
      "failed-precondition",
      "This scan has expired. Scan the customer's code again."
    );
  }
}

/** Answer a repeat call for the same scan with the charge it already raised. */
function replay(
  request: MerchantPaymentRequest,
  merchantId: string,
  requestId: string
): ApiResponse<ChargeResult> {
  if (request.merchantId !== merchantId) {
    throw new https.HttpsError(
      "permission-denied",
      "Token was scanned by a different merchant"
    );
  }
  const expiryMs = requestExpiryMillis(request);
  return {
    success: true,
    data: {
      requestId,
      amount: request.amount,
      status: request.status,
      expiresAt: new Date(expiryMs).toISOString(),
      expiresInSeconds: Math.max(0, Math.round((expiryMs - Date.now()) / 1000)),
    },
  };
}

interface CreatePaymentRequestInput {
  tokenId: string;
  amount: number; // In cents
  currency: string;
  reference?: string;
}

export const createPaymentRequest = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<CreatePaymentRequestInput>
  ): Promise<ApiResponse<ChargeResult>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const db = admin.firestore();

    const merchantDoc = await db.collection("users").doc(merchantId).get();
    if (!merchantDoc.exists) {
      throw new https.HttpsError("not-found", "Merchant not found");
    }

    const merchant = merchantDoc.data() as User;
    // Must match scanCustomerToken: an agent_merchant that can scan a customer
    // token but cannot then raise the charge is stranded halfway through the
    // flow, which is worse than being refused at the scan.
    if (
      merchant.accountType !== "merchant" &&
      merchant.accountType !== "agent_merchant"
    ) {
      throw new https.HttpsError(
        "permission-denied",
        "Only merchants can create payment requests"
      );
    }
    // Stop a frozen merchant raising new charges against customers.
    assertAccountActive(merchant);

    const { tokenId, amount, currency, reference } = request.data;

    // The token ID becomes a document ID in two collections, so it must be a
    // plain ID — a "/" would address some other path.
    if (typeof tokenId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(tokenId)) {
      throw new https.HttpsError("invalid-argument", "Token ID is required");
    }
    if (!validateAmount(amount)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be a positive integer (cents)"
      );
    }
    if (!validateCurrency(currency)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Currency must be USD or SLS"
      );
    }

    // One scan raises at most one charge. The request is keyed by the scanned
    // token, so a double tap or a retry after a dropped reply finds the charge
    // the first call raised instead of failing — a failure there would leave
    // that charge payable while the merchant's screen said it never happened.
    const requestRef = db.collection("paymentRequests").doc(tokenId);
    const existing = await requestRef.get();
    if (existing.exists) {
      return replay(existing.data() as MerchantPaymentRequest, merchantId, requestRef.id);
    }

    const tokenRef = db.collection("customerTokens").doc(tokenId);
    const tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists) {
      throw new https.HttpsError("not-found", "Token not found");
    }

    const token = tokenDoc.data() as CustomerToken;
    assertChargeable(token, merchantId);

    // KYC limit check on the customer
    const customerDoc = await db
      .collection("users")
      .doc(token.customerId)
      .get();
    const customer = customerDoc.data() as User;
    // Only the per-transaction cap: the customer has not spent anything yet,
    // and their daily total is checked when they approve.
    await enforcePerTransactionLimit(amount, customer);

    const { paymentRequestTtlSeconds } = await getRates();
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      now.toMillis() + paymentRequestTtlSeconds * 1000
    );

    const paymentRequest: MerchantPaymentRequest = {
      merchantId,
      customerId: token.customerId,
      tokenId,
      amount,
      currency,
      status: "pending",
      ...(reference ? { reference } : {}),
      createdAt: now,
      expiresAt,
    };

    // The token check is repeated inside the transaction: two calls racing on
    // the same scan both pass the read above, and only one may raise a charge.
    const outcome = await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      const tokenSnap = await tx.get(tokenRef);
      if (requestSnap.exists) {
        return {
          created: false,
          request: requestSnap.data() as MerchantPaymentRequest,
        };
      }
      if (!tokenSnap.exists) {
        throw new https.HttpsError("not-found", "Token not found");
      }
      assertChargeable(tokenSnap.data() as CustomerToken, merchantId);

      tx.create(requestRef, paymentRequest);
      tx.update(tokenRef, { status: "used" });
      return { created: true, request: paymentRequest };
    });

    if (!outcome.created) {
      return replay(outcome.request, merchantId, requestRef.id);
    }

    const amountFormatted = (amount / 100).toFixed(2);
    const notifBody = reference
      ? `${merchant.fullName} is requesting ${currency} ${amountFormatted} — ${reference}`
      : `${merchant.fullName} is requesting ${currency} ${amountFormatted}`;
    sendPushNotification(
      token.customerId,
      "Payment Request",
      notifBody,
      {
        type: "payment_request",
        requestId: requestRef.id,
        merchantName: merchant.fullName,
        amount: amount.toString(),
        currency,
        expiresAt: expiresAt.toDate().toISOString(),
        ...(reference ? { reference } : {}),
      }
    ).catch((err) => console.error("Failed to notify customer:", err));

    return {
      success: true,
      data: {
        requestId: requestRef.id,
        amount,
        status: "pending",
        expiresAt: expiresAt.toDate().toISOString(),
        expiresInSeconds: paymentRequestTtlSeconds,
      },
    };
  }
);
