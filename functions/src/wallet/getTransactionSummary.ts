import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, centsToDollars } from "../utils/validation";
import { ApiResponse, Transaction } from "../types";

type Period = "today" | "week" | "month";

interface GetTransactionSummaryRequest {
  period?: Period;
  /** Minutes east of UTC (e.g. +180 for Somalia) for the "today" boundary. */
  tzOffsetMinutes?: number;
}

interface TransactionSummary {
  period: Period;
  currency: string;
  /** Net amount the merchant earned this period (payments net + commission). */
  netTakings: number;
  /** Net received from payments only. */
  paymentsNet: number;
  /** Commission earned as an agent. */
  commission: number;
  /** Number of income transactions this period. */
  count: number;
  /** Net takings in the previous equal-length window. */
  previousNetTakings: number;
  /** Percentage change vs the previous window, or null when it was zero. */
  deltaPct: number | null;
}

const MAX_DOCS = 2000;

/** Window start (epoch ms) for each period, using the client's tz for "today". */
function windowStart(period: Period, now: number, tzOffsetMinutes: number): number {
  if (period === "today") {
    const local = new Date(now + tzOffsetMinutes * 60000);
    const localMidnightUtc = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate()
    );
    return localMidnightUtc - tzOffsetMinutes * 60000;
  }
  const days = period === "week" ? 7 : 30;
  return now - days * 24 * 60 * 60 * 1000;
}

/** Income (in cents) this transaction represents from the user's perspective. */
function incomeCents(tx: Transaction, userId: string): number {
  if (tx.type === "payment" && tx.toUserId === userId && tx.fromUserId !== userId) {
    return tx.netCents ?? tx.amount;
  }
  if (tx.type === "topup" && tx.fromUserId === userId && (tx.commissionCents ?? 0) > 0) {
    return tx.commissionCents ?? 0;
  }
  // A refund the merchant issued reduces takings by the net they gave back.
  if (tx.type === "refund" && tx.fromUserId === userId) {
    return -(tx.netCents ?? tx.amount);
  }
  return 0;
}

/**
 * Aggregate the merchant's earnings for a period, split into payments vs
 * commission streams, with a vs-previous-period delta for the summary header.
 */
export const getTransactionSummary = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<GetTransactionSummaryRequest>
  ): Promise<ApiResponse<TransactionSummary>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    const period: Period = request.data.period ?? "week";
    const tzOffsetMinutes = request.data.tzOffsetMinutes ?? 0;

    try {
      const db = admin.firestore();
      const now = Date.now();
      const start = windowStart(period, now, tzOffsetMinutes);
      const duration = now - start;
      const prevStart = start - duration;

      const base = db
        .collection("transactions")
        .where("participants", "array-contains", userId)
        .where("status", "==", "completed");

      const [currentSnap, previousSnap] = await Promise.all([
        base
          .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(start))
          .limit(MAX_DOCS)
          .get(),
        base
          .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(prevStart))
          .where("createdAt", "<", admin.firestore.Timestamp.fromMillis(start))
          .limit(MAX_DOCS)
          .get(),
      ]);

      let paymentsNetCents = 0;
      let commissionCents = 0;
      let count = 0;

      currentSnap.forEach((doc) => {
        const tx = doc.data() as Transaction;
        const income = incomeCents(tx, userId);
        if (income === 0) return;
        if (tx.type === "topup") {
          commissionCents += income;
          count += 1;
        } else if (tx.type === "refund") {
          // Refunds reduce takings but aren't counted as income transactions.
          paymentsNetCents += income;
        } else {
          paymentsNetCents += income;
          count += 1;
        }
      });

      let previousNetCents = 0;
      previousSnap.forEach((doc) => {
        previousNetCents += incomeCents(doc.data() as Transaction, userId);
      });

      const netCents = paymentsNetCents + commissionCents;
      const deltaPct =
        previousNetCents > 0
          ? Math.round(((netCents - previousNetCents) / previousNetCents) * 100)
          : null;

      return {
        success: true,
        data: {
          period,
          currency: "USD",
          netTakings: centsToDollars(netCents),
          paymentsNet: centsToDollars(paymentsNetCents),
          commission: centsToDollars(commissionCents),
          count,
          previousNetTakings: centsToDollars(previousNetCents),
          deltaPct,
        },
      };
    } catch (error: any) {
      console.error("Error getting transaction summary:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to get transaction summary"
      );
    }
  }
);
