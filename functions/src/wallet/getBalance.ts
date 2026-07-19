import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { centsToDollars } from "../utils/validation";
import { ApiResponse, Wallet } from "../types";

interface BalanceResponse {
  balance: number; // In dollars
  balanceCents: number; // In cents
  currency: string;
  totalReceived: number;
  totalSent: number;
  lastTransactionAt: Date | null;
}

/**
 * Callable function to get user wallet balance
 */
export const getBalance = https.onCall(
  async (request: https.CallableRequest): 
    Promise<ApiResponse<BalanceResponse>> => {
    // Validate authentication
    requireAuth(request);
    const userId = request.auth!.uid;

    try {
      const db = admin.firestore();
      const walletRef = db.collection("wallets").doc(userId);
      const walletDoc = await walletRef.get();

      if (!walletDoc.exists) {
        throw new https.HttpsError(
          "not-found",
          "Wallet not found. Please contact support."
        );
      }

      const wallet = walletDoc.data() as Wallet;

      return {
        success: true,
        data: {
          balance: centsToDollars(wallet.balance),
          balanceCents: wallet.balance,
          currency: wallet.currency,
          totalReceived: centsToDollars(wallet.totalReceived),
          totalSent: centsToDollars(wallet.totalSent),
          lastTransactionAt: wallet.lastTransactionAt?.toDate() || null,
        },
      };
    } catch (error: any) {
      console.error("Error getting balance:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to get balance"
      );
    }
  }
);
