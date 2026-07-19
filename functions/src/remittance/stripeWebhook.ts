/**
 * Stripe webhook — handles payment_intent.succeeded for web top-ups.
 * Credits recipient wallet and notifies them via FCM.
 */
import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { verifyWebhook } from "../integrations/stripe.service";
import { notifyPaymentReceived } from "../utils/notifications";
import { Transaction } from "../types";
import { prepareJournalEntry, userAccount, FLOAT_BANK } from "../ledger";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

export const stripeWebhook = https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  const rawBody = (req as any).rawBody || req.body;

  const event = verifyWebhook(rawBody, sig || "", STRIPE_WEBHOOK_SECRET);
  if (!event) {
    res.status(400).send("Webhook verification failed");
    return;
  }

  const stripeEvent = event as { type: string; data: { object: any } };

  if (stripeEvent.type !== "payment_intent.succeeded") {
    res.json({ received: true });
    return;
  }

  const pi = stripeEvent.data.object;
  const paymentIntentId: string = pi.id;

  const db = admin.firestore();

  try {
    const topupQuery = await db
      .collection("webTopups")
      .where("paymentIntentId", "==", paymentIntentId)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (topupQuery.empty) {
      // Not a web top-up PaymentIntent — ignore
      res.json({ received: true });
      return;
    }

    const topupRef = topupQuery.docs[0].ref;
    const topup = topupQuery.docs[0].data();

    await db.runTransaction(async (tx) => {
      const topupSnap = await tx.get(topupRef);
      if (topupSnap.data()?.status !== "pending") return; // idempotency

      const transactionRef = db.collection("transactions").doc();
      const PLATFORM_ID = "platform";

      // Stripe settles to the company bank account; the recipient's wallet
      // liability grows to match.
      const pending = await prepareJournalEntry(tx, {
        entryId: `stripetopup_${topupRef.id}`,
        type: "stripe_topup",
        currency: "USD",
        lines: [
          { account: FLOAT_BANK, debit: topup.amountUsd, credit: 0 },
          { account: userAccount(topup.recipientId), debit: 0, credit: topup.amountUsd },
        ],
        refs: { transactionId: transactionRef.id, topupId: topupRef.id },
        description: `Diaspora top-up from ${topup.senderName || "anonymous"}`,
        postedBy: "system",
      });

      const txRecord: Transaction = {
        type: "topup",
        fromUserId: PLATFORM_ID,
        toUserId: topup.recipientId,
        participants: [PLATFORM_ID, topup.recipientId],
        amount: topup.amountUsd,
        currency: "USD",
        status: "completed",
        description: `Diaspora top-up from ${topup.senderName || "anonymous"}`,
        journalEntryId: `stripetopup_${topupRef.id}`,
        createdAt: admin.firestore.Timestamp.now(),
        completedAt: admin.firestore.Timestamp.now(),
      };

      pending.write(tx);

      tx.set(transactionRef, txRecord);

      tx.update(topupRef, {
        status: "completed",
        completedAt: admin.firestore.Timestamp.now(),
        transactionId: transactionRef.id,
      });
    });

    notifyPaymentReceived(
      topup.recipientId,
      topup.amountUsd,
      "USD",
      topup.senderName || "diaspora"
    ).catch((err) => console.error("FCM notify failed:", err));

    res.json({ received: true });
  } catch (err: any) {
    console.error("stripeWebhook error:", err);
    res.status(500).send("Internal error");
  }
});
