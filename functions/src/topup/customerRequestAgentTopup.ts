import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import {
  requireAuth,
  validateAmount,
  validateTransactionLimit,
} from "../utils/validation";
import { ApiResponse, Wallet, AgentTopupRequest, User } from "../types";

const TOPUP_EXPIRY_MINUTES = 30;
const MIN_TOPUP_CENTS = 100; // $1 minimum
const MAX_TOPUP_CENTS = 100000; // $1000 maximum (matches manualTopup cap)
// Request-creation velocity — generous for real cash-in behaviour in Hargeisa
// (a customer might retry a few times at an agent kiosk) but stops scripted
// request spam cold.
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_REQUESTS_PER_DAY = 15;

interface CustomerRequestAgentTopupRequest {
  amount: number; // In cents
}

interface CustomerRequestAgentTopupResponse {
  requestId: string;
  otpCode: string;
  amount: number;
  expiresAt: string;
}

function generateOTP(): string {
  // crypto-secure: Math.random() output can be predicted from observations
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Customer-initiated "Zapp Agent" top-up request.
 *
 * The customer picks an amount and receives a QR + 6-digit code. No PIN and no
 * wallet movement here — the customer is receiving money, and nothing is
 * credited until an agent confirms (by scanning/entering the code) after
 * collecting the cash. Mirrors customerCashOut but in reverse.
 */
export const customerRequestAgentTopup = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<CustomerRequestAgentTopupRequest>
  ): Promise<ApiResponse<CustomerRequestAgentTopupResponse>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;

    const { amount } = request.data;

    if (!validateAmount(amount) || amount < MIN_TOPUP_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `Minimum top-up is $${MIN_TOPUP_CENTS / 100}`
      );
    }
    if (amount > MAX_TOPUP_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `Maximum top-up is $${MAX_TOPUP_CENTS / 100}`
      );
    }

    const db = admin.firestore();

    // KYC-tiered cap: unverified accounts are limited to smaller cash-ins.
    const userDoc = await db.collection("users").doc(customerId).get();
    if (!userDoc.exists) {
      throw new https.HttpsError("not-found", "User not found");
    }
    const userData = userDoc.data() as User;
    const limitCheck = validateTransactionLimit(amount, userData.kycStatus);
    if (!limitCheck.valid) {
      throw new https.HttpsError("failed-precondition", limitCheck.reason!);
    }

    // Velocity: cap how many requests a customer can create per hour/day.
    const nowMs = Date.now();
    const [hourSnap, daySnap] = await Promise.all([
      db
        .collection("agentTopupRequests")
        .where("customerId", "==", customerId)
        .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(nowMs - 60 * 60 * 1000))
        .count()
        .get(),
      db
        .collection("agentTopupRequests")
        .where("customerId", "==", customerId)
        .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(nowMs - 24 * 60 * 60 * 1000))
        .count()
        .get(),
    ]);
    if (
      hourSnap.data().count >= MAX_REQUESTS_PER_HOUR ||
      daySnap.data().count >= MAX_REQUESTS_PER_DAY
    ) {
      throw new https.HttpsError(
        "resource-exhausted",
        "Too many top-up requests. Please try again later."
      );
    }

    // The wallet must exist (established at signup) so the currency is known.
    const walletDoc = await db.collection("wallets").doc(customerId).get();
    if (!walletDoc.exists) {
      throw new https.HttpsError("not-found", "Wallet not found");
    }
    const wallet = walletDoc.data() as Wallet;

    // Only one active request at a time — cancel any existing pending ones.
    const existing = await db
      .collection("agentTopupRequests")
      .where("customerId", "==", customerId)
      .where("status", "==", "pending")
      .get();
    const cancelBatch = db.batch();
    existing.forEach((doc) =>
      cancelBatch.update(doc.ref, { status: "cancelled" })
    );
    await cancelBatch.commit();

    const now = admin.firestore.Timestamp.now();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + TOPUP_EXPIRY_MINUTES);

    const otpCode = generateOTP();
    const topupRef = db.collection("agentTopupRequests").doc();

    const record: AgentTopupRequest = {
      customerId,
      amount,
      currency: wallet.currency,
      otpCode,
      status: "pending",
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdAt: now,
    };

    await topupRef.set(record);

    return {
      success: true,
      data: {
        requestId: topupRef.id,
        otpCode,
        amount,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }
);
