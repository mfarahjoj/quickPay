import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { sendPushNotification } from "../utils/notifications";
import { ApiResponse, CashOutRequest, Transaction, User } from "../types";
import { getRates, computeCommission } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
  CASHOUT_HOLD,
} from "../ledger";

interface AgentConfirmCashOutRequest {
  otpCode: string;
}

interface AgentConfirmCashOutResponse {
  cashOutId: string;
  amount: number;
  customerName: string;
  commission: number;
}

export const agentConfirmCashOut = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<AgentConfirmCashOutRequest>
  ): Promise<ApiResponse<AgentConfirmCashOutResponse>> => {
    requireAuth(request);
    const agentId = request.auth!.uid;

    const { otpCode } = request.data;

    if (!otpCode || otpCode.length !== 6) {
      throw new https.HttpsError("invalid-argument", "6-digit OTP code required");
    }

    const db = admin.firestore();

    // Verify agent role
    const agentDoc = await db.collection("users").doc(agentId).get();
    if (!agentDoc.exists) {
      throw new https.HttpsError("not-found", "Agent not found");
    }
    const agentData = agentDoc.data() as User;
    if (
      agentData.accountType !== "topup_agent" &&
      agentData.accountType !== "agent_merchant"
    ) {
      throw new https.HttpsError("permission-denied", "Only agents can confirm cash-outs");
    }

    // Find the pending cash-out with this OTP
    const snapshot = await db
      .collection("cashOutRequests")
      .where("otpCode", "==", otpCode)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new https.HttpsError(
        "not-found",
        "Invalid or expired code. Ask the customer to generate a new one."
      );
    }

    const cashOutDoc = snapshot.docs[0];
    const cashOut = cashOutDoc.data() as CashOutRequest;

    if (new Date() > cashOut.expiresAt.toDate()) {
      // Expire and return the held amount to the customer.
      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(cashOutDoc.ref)).data() as CashOutRequest;
        if (fresh.status !== "pending") return;
        const pending = await prepareJournalEntry(tx, {
          entryId: `cashoutrelease_${cashOutDoc.id}`,
          type: "adjustment",
          currency: cashOut.currency as "USD" | "SLS",
          lines: [
            { account: CASHOUT_HOLD, debit: cashOut.amount, credit: 0 },
            { account: userAccount(cashOut.customerId), debit: 0, credit: cashOut.amount },
          ],
          refs: { topupId: cashOutDoc.id },
          description: "Cash-out expired — hold returned",
          postedBy: "system",
        });
        pending.write(tx);
        tx.update(cashOutDoc.ref, { status: "expired" });
      });
      throw new https.HttpsError("failed-precondition", "This code has expired");
    }

    // Fetch customer name for response
    const customerDoc = await db.collection("users").doc(cashOut.customerId).get();
    const customerName = customerDoc.data()?.fullName || "Customer";

    const { topupCommissionRate } = await getRates();
    const commissionCents = computeCommission(cashOut.amount, topupCommissionRate);
    const now = admin.firestore.Timestamp.now();
    const transactionId = db.collection("transactions").doc().id;

    await db.runTransaction(async (tx) => {
      const freshCashOut = (await tx.get(cashOutDoc.ref)).data() as CashOutRequest;
      if (freshCashOut.status !== "pending") {
        throw new https.HttpsError("failed-precondition", "Code already used");
      }

      // The held amount becomes the agent's float — they handed out physical
      // cash and get e-money back, mirroring the top-up float model — plus a
      // platform-funded commission.
      const lines: JournalLine[] = [
        { account: CASHOUT_HOLD, debit: cashOut.amount, credit: 0 },
        { account: userAccount(agentId), debit: 0, credit: cashOut.amount },
      ];
      if (commissionCents > 0) {
        lines.push({ account: PLATFORM_FEES, debit: commissionCents, credit: 0 });
        lines.push({ account: userAccount(agentId), debit: 0, credit: commissionCents });
      }

      const pending = await prepareJournalEntry(tx, {
        entryId: `cashout_${cashOutDoc.id}`,
        type: "agent_cashout",
        currency: cashOut.currency as "USD" | "SLS",
        lines,
        refs: { transactionId, topupId: cashOutDoc.id },
        description: "Agent cash-out",
        postedBy: agentId,
      });

      pending.write(tx);

      // Mark cash-out complete
      tx.update(cashOutDoc.ref, {
        status: "completed",
        agentId,
        completedAt: now,
      });

      // Transaction record
      const txRecord: Transaction = {
        type: "withdrawal",
        fromUserId: cashOut.customerId,
        toUserId: agentId,
        participants: [cashOut.customerId, agentId],
        amount: cashOut.amount,
        commissionCents,
        currency: cashOut.currency,
        status: "completed",
        description: "Agent cash-out",
        journalEntryId: `cashout_${cashOutDoc.id}`,
        createdAt: now,
        completedAt: now,
      };
      tx.set(db.collection("transactions").doc(transactionId), txRecord);
    });

    sendPushNotification(
      cashOut.customerId,
      "Cash Out Complete",
      `${agentData.fullName} confirmed your cash-out of ${cashOut.currency} ${(cashOut.amount / 100).toFixed(2)}`,
      { type: "cashout_complete", transactionId }
    ).catch((err) => console.error("Failed to notify customer:", err));

    return {
      success: true,
      data: {
        cashOutId: cashOutDoc.id,
        amount: cashOut.amount,
        customerName,
        commission: commissionCents,
      },
    };
  }
);
