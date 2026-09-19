/**
 * A merchant asking for their takings.
 *
 * Until now a merchant could take payments all day and had no way to get the
 * money out — the float desk only serves agents, and agent cash-out is the
 * wrong instrument for a shop: it would cost the platform 2% commission to
 * return money it earned 1% on, and no agent carries a supermarket's daily
 * takings in cash.
 *
 * So this is a settlement request, not a cash-out. The wallet is debited into
 * `platform:settlement_hold` the moment the merchant asks, and the value only
 * leaves a float account once ops has actually sent the transfer and recorded
 * its reference (`admin/payoutDesk.ts`). Holding at request time is the part
 * that matters: without it a merchant could spend money that is already on its
 * way to their bank, and ops would be sending value the wallet no longer has.
 *
 * Journal (LEDGER_ARCHITECTURE.md §3.4):
 *   request   — debit user:{merchant}, credit platform:settlement_hold
 *   settle    — debit platform:settlement_hold, credit float:{route}
 *   reject    — debit platform:settlement_hold, credit user:{merchant}
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { getRates } from "../config/rates";
import { isFloatRoute } from "../ledger";
import {
  prepareJournalEntry,
  userAccount,
  SETTLEMENT_HOLD,
  InsufficientBalanceError,
  WalletNotFoundError,
} from "../ledger";
import { ApiResponse, PayoutRequest, Transaction, User } from "../types";

export const PAYOUT_REQUESTS_COLLECTION = "payoutRequests";

/** Below this a payout costs more in bank fees and ops time than it moves. */
const MIN_PAYOUT_CENTS = 500;

/** A typo should not become a five-figure transfer. */
const MAX_PAYOUT_CENTS = 1_000_000_00;

/** Queued requests per merchant. Stops a merchant tying up ops with a queue. */
const MAX_OPEN_REQUESTS = 3;

interface RequestPayoutInput {
  amountCents: number;
  route: string;
  destinationName: string;
  destinationRef: string;
  note?: string;
  pin: string;
}

export const requestPayout = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<RequestPayoutInput>
  ): Promise<ApiResponse<{ payoutId: string; amountCents: number }>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const { amountCents, route, destinationName, destinationRef, note, pin } =
      request.data ?? {};

    if (!pin) {
      throw new https.HttpsError("invalid-argument", "PIN is required");
    }
    if (
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      amountCents < MIN_PAYOUT_CENTS
    ) {
      throw new https.HttpsError(
        "invalid-argument",
        `Payouts start at $${MIN_PAYOUT_CENTS / 100}`
      );
    }
    if (amountCents > MAX_PAYOUT_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `A single payout is capped at $${MAX_PAYOUT_CENTS / 100}`
      );
    }
    if (!isFloatRoute(route)) {
      throw new https.HttpsError(
        "invalid-argument",
        "route must be cash, zaad, edahab or bank"
      );
    }

    const name = typeof destinationName === "string" ? destinationName.trim() : "";
    const ref = typeof destinationRef === "string" ? destinationRef.trim() : "";
    if (name.length < 2 || ref.length < 3) {
      throw new https.HttpsError(
        "invalid-argument",
        "Tell us the account name and number to send the money to"
      );
    }

    const db = admin.firestore();

    const merchantSnap = await db.collection("users").doc(merchantId).get();
    if (!merchantSnap.exists) {
      throw new https.HttpsError("not-found", "Account not found");
    }
    const merchant = merchantSnap.data() as User;
    if (
      merchant.accountType !== "merchant" &&
      merchant.accountType !== "agent_merchant"
    ) {
      throw new https.HttpsError(
        "permission-denied",
        "Only merchant accounts can request a payout"
      );
    }
    assertAccountActive(merchant);

    // The payout debits the merchant's own wallet, so it is a user-initiated
    // debit and takes a PIN like every other one.
    const pinValid = await verifyUserPin(merchantId, pin);
    if (!pinValid) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    const open = await db
      .collection(PAYOUT_REQUESTS_COLLECTION)
      .where("merchantId", "==", merchantId)
      .where("status", "==", "requested")
      .limit(MAX_OPEN_REQUESTS)
      .get();
    if (open.size >= MAX_OPEN_REQUESTS) {
      throw new https.HttpsError(
        "resource-exhausted",
        "You already have payouts waiting. They will be sent before you can request another."
      );
    }

    const profileSnap = await db
      .collection("merchantProfiles")
      .doc(merchantId)
      .get();
    const businessName = profileSnap.exists
      ? (profileSnap.data() as any)?.businessName
      : undefined;

    // Reuses the float desk's threshold: the question ("is this big enough to
    // need a second pair of eyes?") is the same one, and one number is easier
    // to reason about during a pilot than two.
    const { floatApprovalThresholdCents } = await getRates();
    const requiresSeniorApproval = amountCents >= floatApprovalThresholdCents;

    const payoutRef = db.collection(PAYOUT_REQUESTS_COLLECTION).doc();
    const holdEntryId = `payout_hold_${payoutRef.id}`;
    const now = admin.firestore.Timestamp.now();

    try {
      await db.runTransaction(async (tx) => {
        const prepared = await prepareJournalEntry(tx, {
          entryId: holdEntryId,
          type: "payout_hold",
          currency: "USD",
          lines: [
            { account: userAccount(merchantId), debit: amountCents, credit: 0 },
            { account: SETTLEMENT_HOLD, debit: 0, credit: amountCents },
          ],
          refs: { payoutId: payoutRef.id },
          description: "Payout requested",
          postedBy: merchantId,
        });

        prepared.write(tx);

        const payout: PayoutRequest = {
          merchantId,
          merchantName: merchant.fullName,
          ...(businessName ? { businessName } : {}),
          amountCents,
          route,
          destinationName: name,
          destinationRef: ref,
          ...(typeof note === "string" && note.trim()
            ? { note: note.trim().slice(0, 200) }
            : {}),
          status: "requested",
          requiresSeniorApproval,
          createdAt: now,
          holdEntryId,
        };

        tx.create(payoutRef, payout);

        // The merchant sees the money leave their balance now, so it needs a
        // row in their history now — not when ops gets round to sending it.
        const txRecord: Transaction = {
          type: "withdrawal",
          fromUserId: merchantId,
          toUserId: "system",
          participants: [merchantId],
          amount: amountCents,
          currency: "USD",
          status: "pending",
          description: `Payout requested (${route})`,
          journalEntryId: holdEntryId,
          createdAt: now,
        };
        tx.set(db.collection("transactions").doc(holdEntryId), txRecord);
      });
    } catch (error: any) {
      if (error instanceof InsufficientBalanceError) {
        throw new https.HttpsError(
          "failed-precondition",
          "You don't have that much in your balance"
        );
      }
      if (error instanceof WalletNotFoundError) {
        throw new https.HttpsError("failed-precondition", "Wallet not found");
      }
      if (error instanceof https.HttpsError) throw error;
      console.error("Payout request failed:", error);
      throw new https.HttpsError("internal", "Could not request the payout");
    }

    console.log(
      `Payout ${payoutRef.id} requested by ${merchantId}: ${amountCents} via ${route}`
    );

    return {
      success: true,
      message: "Requested — we'll send it and confirm here",
      data: { payoutId: payoutRef.id, amountCents },
    };
  }
);
