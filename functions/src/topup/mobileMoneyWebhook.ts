import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { verifyWebhookSignature } from "../utils/encryption";
import { Transaction } from "../types";
import {
  prepareJournalEntry,
  userAccount,
  mobileMoneyFloat,
} from "../ledger";

interface WebhookBody {
  provider: "zaad" | "edahab";
  transactionId: string;
  status: "completed" | "failed";
  reference: string;
  signature: string;
}

const WEBHOOK_SECRETS: Record<string, string> = {
  zaad: process.env.ZAAD_WEBHOOK_SECRET || "",
  edahab: process.env.EDAHAB_WEBHOOK_SECRET || "",
};

export const mobileMoneyWebhook = https.onRequest(
  async (req: https.Request, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const { provider, transactionId, status, reference, signature } =
      req.body as WebhookBody;

    if (!provider || !transactionId || !status || !reference || !signature) {
      res.status(400).send("Missing required fields");
      return;
    }

    if (!["zaad", "edahab"].includes(provider)) {
      res.status(400).send("Invalid provider");
      return;
    }

    const secret = WEBHOOK_SECRETS[provider];
    if (!secret) {
      console.error(`No webhook secret configured for ${provider}`);
      res.status(500).send("Server configuration error");
      return;
    }

    const payload = JSON.stringify({
      provider,
      transactionId,
      status,
      reference,
    });

    try {
      const validSignature = verifyWebhookSignature(payload, signature, secret);
      if (!validSignature) {
        console.error(`Invalid webhook signature for ${provider}`);
        res.status(401).send("Invalid signature");
        return;
      }
    } catch (error) {
      console.error("Signature verification error:", error);
      res.status(401).send("Invalid signature");
      return;
    }

    try {
      const db = admin.firestore();

      const topupsQuery = await db
        .collection("topups")
        .where("externalTransactionId", "==", transactionId)
        .limit(1)
        .get();

      let topupDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

      if (topupsQuery.empty) {
        const byRefQuery = await db
          .collection("topups")
          .where("reference", "==", reference)
          .limit(1)
          .get();

        if (byRefQuery.empty) {
          console.error(`No topup found for reference: ${reference}`);
          res.status(404).send("Topup not found");
          return;
        }

        topupDoc = byRefQuery.docs[0];
      } else {
        topupDoc = topupsQuery.docs[0];
      }

      const topupData = topupDoc.data();
      const topupId = topupDoc.id;

      if (topupData.status === "completed" || topupData.status === "failed") {
        res.status(200).json({ message: "Already processed" });
        return;
      }

      if (status === "completed" && topupData.status === "pending") {
        const txId = db.collection("transactions").doc().id;

        await db.runTransaction(async (transaction) => {
          const pending = await prepareJournalEntry(transaction, {
            entryId: `mmtopup_${topupId}`,
            type: "mobile_money_topup",
            currency: topupData.currency as "USD" | "SLS",
            lines: [
              { account: mobileMoneyFloat(provider), debit: topupData.amount, credit: 0 },
              { account: userAccount(topupData.userId), debit: 0, credit: topupData.amount },
            ],
            refs: { transactionId: txId, topupId },
            description: `Top-up via ${provider} (webhook)`,
            postedBy: "system",
          });

          pending.write(transaction);

          const txRecord: Transaction = {
            type: "topup",
            fromUserId: topupData.userId,
            toUserId: topupData.userId,
            participants: [topupData.userId],
            amount: topupData.amount,
            currency: topupData.currency,
            status: "completed",
            description: `Top-up via ${provider} (webhook)`,
            journalEntryId: `mmtopup_${topupId}`,
            createdAt: admin.firestore.Timestamp.now(),
            completedAt: admin.firestore.Timestamp.now(),
          };

          transaction.set(db.collection("transactions").doc(txId), txRecord);

          transaction.update(db.collection("topups").doc(topupId), {
            status: "completed",
            externalTransactionId: transactionId,
            webhookReceived: true,
            completedAt: admin.firestore.Timestamp.now(),
          });
        });

        console.log(
          `Webhook processed: topup ${topupId} completed via ${provider}`
        );
      } else if (status === "failed") {
        await db.collection("topups").doc(topupId).update({
          status: "failed",
          webhookReceived: true,
          errorMessage: "Payment failed (webhook notification)",
        });

        console.log(
          `Webhook processed: topup ${topupId} failed via ${provider}`
        );
      }

      res.status(200).json({ message: "OK" });
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).send("Internal server error");
    }
  }
);
