/**
 * Public (unauthenticated) HTTPS endpoint for diaspora web top-up.
 * Sender doesn't need a QuickPay account — just enters a Hargeisa phone number
 * and pays with a card via Stripe. Webhook credits the recipient wallet on success.
 */
import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { createPaymentIntent } from "../integrations/stripe.service";
import { generateSecureId } from "../utils/encryption";
import { validateAmount } from "../utils/validation";

interface CreateWebTopupBody {
  recipientPhone: string;
  amountUsd: number; // USD cents, e.g. 1000 = $10
  senderName?: string;
  senderNote?: string;
  lookupOnly?: boolean; // true = just resolve recipient name, don't create PaymentIntent
}

// CORS-enabled plain HTTP function so the web page can call it without Firebase SDK.
export const createWebTopup = https.onRequest(
  { cors: ["https://quickpay-485417.web.app", "http://localhost:5000", "https://quickpay-485417.firebaseapp.com"] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    const { recipientPhone, amountUsd, senderName, senderNote, lookupOnly } =
      req.body as CreateWebTopupBody;

    if (!recipientPhone || typeof recipientPhone !== "string") {
      res.status(400).json({ success: false, error: "recipientPhone is required" });
      return;
    }

    // lookupOnly: just resolve the recipient name, no PaymentIntent created
    if (lookupOnly) {
      try {
        const db = admin.firestore();
        const q = await db
          .collection("users")
          .where("phoneNumber", "==", recipientPhone)
          .limit(1)
          .get();
        if (q.empty) {
          res.status(404).json({ success: false, error: "No QuickPay account found for that number" });
        } else {
          res.json({ success: true, recipientName: q.docs[0].data().fullName || "QuickPay user" });
        }
      } catch {
        res.status(500).json({ success: false, error: "Internal error" });
      }
      return;
    }

    if (!validateAmount(amountUsd) || amountUsd < 100 || amountUsd > 50000_00) {
      res.status(400).json({ success: false, error: "Amount must be between $1.00 and $5,000" });
      return;
    }

    try {
      const db = admin.firestore();

      const recipientQuery = await db
        .collection("users")
        .where("phoneNumber", "==", recipientPhone)
        .limit(1)
        .get();

      if (recipientQuery.empty) {
        res.status(404).json({ success: false, error: "No QuickPay account found for that number" });
        return;
      }

      const recipientDoc = recipientQuery.docs[0];
      const recipient = recipientDoc.data();
      const recipientId = recipientDoc.id;
      const recipientName = recipient.fullName || "QuickPay user";

      const webTopupId = generateSecureId(16);

      const paymentResult = await createPaymentIntent({
        amount: amountUsd,
        currency: "USD",
        customerId: `web_${webTopupId}`,
        description: `QuickPay top-up for ${recipientName} (${recipientPhone})`,
      });

      if (!paymentResult.success || !paymentResult.clientSecret) {
        res.status(500).json({ success: false, error: "Failed to create payment" });
        return;
      }

      await db.collection("webTopups").doc(webTopupId).set({
        recipientPhone,
        recipientId,
        recipientName,
        amountUsd,
        senderName: senderName?.trim() || null,
        senderNote: senderNote?.trim() || null,
        paymentIntentId: paymentResult.paymentIntentId,
        status: "pending",
        createdAt: admin.firestore.Timestamp.now(),
      });

      res.json({
        success: true,
        webTopupId,
        clientSecret: paymentResult.clientSecret,
        recipientName,
        amountUsd,
      });
    } catch (err: any) {
      console.error("createWebTopup error:", err);
      res.status(500).json({ success: false, error: "Internal error" });
    }
  }
);
