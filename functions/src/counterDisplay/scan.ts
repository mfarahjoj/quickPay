/**
 * A customer holds their Zapp code to the counter display's scanner.
 *
 * The tablet sends the id of the sale it is showing, never an amount: the
 * cashier set the amount when they opened the sale on their phone, and the
 * request copies it from that sale. So a tablet (or anyone holding its
 * secret) can only ask a customer to pay the sale the cashier opened, and the
 * customer still sees shop, amount and note on their own phone and approves
 * with their PIN (approvePaymentRequest, unchanged).
 *
 * One transaction voids the sale's QR and raises the request.
 * processPayment pays a QR only while its doc is `active`, read inside its
 * own transaction, so exactly one of "the customer paid the QR" and "the
 * customer was sent a request" can commit. Without that, one sale could be
 * paid twice.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { getRates } from "../config/rates";
import { ENCRYPTION_KEY, PIN_PEPPER } from "../config/secrets";
import { decrypt } from "../utils/encryption";
import { enforcePerTransactionLimit } from "../utils/limits";
import { sendPushNotification } from "../utils/notifications";
import { PushMessage } from "../utils/pushTemplates";
import { CustomerToken, MerchantPaymentRequest, QRCode, User } from "../types";
import { requestExpiryMillis } from "../customer-qr/requestExpiry";
import { requireDisplay } from "./guard";
import { firstName, shopName, syncCounterStateQuietly } from "./state";
import { normaliseScannedToken } from "./tokenFormat";

const QR_ID = /^[a-f0-9]{32}$/;

interface ScanInput {
  displayId?: string;
  secret?: string;
  saleId?: string;
  tokenData?: string;
}

interface ScanResult {
  requestId: string;
  amountCents: number;
  customerFirstName: string;
  expiresAtMs: number;
}

function fail(code: https.FunctionsErrorCode, message: string, reason: string): https.HttpsError {
  return new https.HttpsError(code, message, { reason });
}

export const displayScanCustomer = https.onCall(
  { enforceAppCheck: true, secrets: [ENCRYPTION_KEY, PIN_PEPPER] },
  async (request: https.CallableRequest<ScanInput>): Promise<{ success: true; data: ScanResult }> => {
    const { merchantId, merchant, displayId } = await requireDisplay(request);
    const saleId = request.data?.saleId;
    if (typeof saleId !== "string" || !QR_ID.test(saleId)) {
      throw fail("failed-precondition", "Ask the cashier to enter the amount first.", "no_active_sale");
    }

    const token = normaliseScannedToken(request.data?.tokenData);
    if (!token) throw fail("invalid-argument", "That isn't a Zapp Pay code.", "not_a_zapp_code");

    let parsed: { id?: unknown; customerId?: unknown };
    try {
      parsed = JSON.parse(decrypt(token));
    } catch {
      throw fail("invalid-argument", "That isn't a Zapp Pay code.", "not_a_zapp_code");
    }
    const tokenId = parsed.id;
    const customerId = parsed.customerId;
    if (
      typeof tokenId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(tokenId) ||
      typeof customerId !== "string"
    ) {
      throw fail("invalid-argument", "That isn't a Zapp Pay code.", "not_a_zapp_code");
    }
    if (customerId === merchantId) {
      throw fail("permission-denied", "That's the shop's own code.", "own_code");
    }

    const db = admin.firestore();
    const saleRef = db.collection("qrCodes").doc(saleId);
    const tokenRef = db.collection("customerTokens").doc(tokenId);
    const requestRef = db.collection("paymentRequests").doc(tokenId);

    // Checks that need no lock, as createPaymentRequest does them: the
    // customer's per-payment cap against the sale's amount.
    const [saleSnap, customerSnap] = await Promise.all([
      saleRef.get(),
      db.collection("users").doc(customerId).get(),
    ]);
    const salePeek = saleSnap.data() as QRCode | undefined;
    const customer = customerSnap.data() as User | undefined;
    if (!customerSnap.exists || !customer) {
      throw fail("not-found", "That Zapp Pay code isn't valid any more.", "token_invalid");
    }
    if (salePeek && salePeek.merchantId === merchantId && salePeek.status === "active") {
      await enforcePerTransactionLimit(salePeek.amount, customer);
    }
    const { paymentRequestTtlSeconds } = await getRates();

    const outcome = await db.runTransaction(async (tx) => {
      const [sSnap, tSnap, rSnap] = await Promise.all([tx.get(saleRef), tx.get(tokenRef), tx.get(requestRef)]);

      // The scanner read the same code twice: answer with the request it raised.
      if (rSnap.exists) {
        const existing = rSnap.data() as MerchantPaymentRequest;
        if (existing.merchantId !== merchantId) {
          throw fail("failed-precondition", "That Zapp Pay code has already been used.", "token_used");
        }
        return { created: false, request: existing };
      }

      const sale = sSnap.data() as QRCode | undefined;
      if (!sSnap.exists || !sale || sale.merchantId !== merchantId) {
        throw fail("failed-precondition", "Ask the cashier to enter the amount first.", "no_active_sale");
      }
      if (sale.status === "used") {
        throw fail("failed-precondition", "This sale has already been paid.", "already_paid");
      }
      if (sale.status !== "active" || sale.expiresAt.toMillis() <= Date.now()) {
        throw fail("failed-precondition", "Ask the cashier to enter the amount first.", "no_active_sale");
      }

      const tok = tSnap.data() as CustomerToken | undefined;
      if (!tSnap.exists || !tok || tok.customerId !== customerId) {
        throw fail("not-found", "That Zapp Pay code isn't valid any more.", "token_invalid");
      }
      if (tok.status !== "active") {
        throw fail("failed-precondition", "That Zapp Pay code has already been used.", "token_used");
      }
      if (tok.expiresAt.toMillis() <= Date.now()) {
        throw fail("failed-precondition", "That Zapp Pay code has run out. Open a new one.", "token_expired");
      }

      const now = admin.firestore.Timestamp.now();
      const paymentRequest: MerchantPaymentRequest = {
        merchantId,
        customerId,
        tokenId,
        amount: sale.amount,
        currency: sale.currency,
        status: "pending",
        ...(sale.reference ? { reference: sale.reference } : {}),
        createdAt: now,
        expiresAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + paymentRequestTtlSeconds * 1000),
        source: "counter_display",
        displayId,
        saleId,
        customerName: customer.fullName || "",
      };

      tx.update(tokenRef, {
        status: "used",
        scannedBy: merchantId,
        scannedAt: now,
        scannedVia: "counter_display",
      });
      tx.create(requestRef, paymentRequest);
      tx.update(saleRef, { status: "expired", cancelledAt: now, supersededBy: requestRef.id });
      return { created: true, request: paymentRequest };
    });

    const req = outcome.request;
    if (outcome.created) {
      const profile = (await db.collection("merchantProfiles").doc(merchantId).get()).data();
      const name = shopName(merchant, profile);
      const amountText = `${req.currency} ${(req.amount / 100).toFixed(2)}`;
      const message: PushMessage = req.reference
        ? { key: "payment.request_with_reference", params: { merchant: name, amount: amountText, reference: req.reference } }
        : { key: "payment.request", params: { merchant: name, amount: amountText } };
      sendPushNotification(customerId, message, {
        type: "payment_request",
        requestId: requestRef.id,
        merchantName: name,
        amount: req.amount.toString(),
        currency: req.currency,
        expiresAt: new Date(requestExpiryMillis(req)).toISOString(),
        ...(req.reference ? { reference: req.reference } : {}),
      }).catch((err) => console.error("Failed to notify customer:", err));
    }

    await syncCounterStateQuietly(merchantId);

    return {
      success: true,
      data: {
        requestId: requestRef.id,
        amountCents: req.amount,
        customerFirstName: firstName(req.customerName ?? customer.fullName),
        expiresAtMs: requestExpiryMillis(req),
      },
    };
  }
);
