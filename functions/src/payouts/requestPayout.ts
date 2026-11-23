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
 *
 * A payout is in one currency (SHILLINGS.md): shillings come out of the
 * wallet's shilling balance, are held in platform:settlement_hold@SLS and
 * are sent as shillings, never converted. The limits are in dollars and
 * count shillings at `slsPerUsd`.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { requireAuth } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { getRates } from "../config/rates";
import { rollingWindowStart, sumStandingCents } from "../utils/rollingTotal";
import { type FloatRoute } from "../ledger";
import { zaadLabel, zaadPayoutBlock, zaadPayoutBlockMessage } from "../auth/zaadAccount";
import {
  prepareJournalEntry,
  userAccount,
  SETTLEMENT_HOLD,
  InsufficientBalanceError,
  WalletNotFoundError,
} from "../ledger";
import { ApiResponse, PayoutRequest, Transaction, User } from "../types";
import { Currency, formatAmount, parseCurrency, toLimitCents } from "../utils/money";

export const PAYOUT_REQUESTS_COLLECTION = "payoutRequests";

/** Below this a payout costs more in bank fees and ops time than it moves. */
const MIN_PAYOUT_CENTS = 500;

/** A typo should not become a five-figure transfer. */
const MAX_PAYOUT_CENTS = 1_000_000_00;

/** Queued requests per merchant. Stops a merchant tying up ops with a queue. */
const MAX_OPEN_REQUESTS = 3;

interface RequestPayoutInput {
  /** In the currency's smallest unit: cents, or whole shillings. */
  amountCents: number;
  /** "USD" (the default, and all older apps send) or "SLS". */
  currency?: string;
  note?: string;
  pin: string;
  // Older apps still send a route and destination. Payouts now go only to
  // the Zaad account on file (auth/zaadAccount.ts), so these are ignored.
  route?: string;
  destinationName?: string;
  destinationRef?: string;
}

export interface PayoutInput {
  amountCents: number;
  /** Dollars unless said otherwise. */
  currency?: Currency;
  route: FloatRoute;
  destinationName: string;
  destinationRef: string;
  note?: string;
  /** Raised by the daily automatic payout rather than the merchant. */
  auto?: boolean;
}

/**
 * Hold the money and queue the payout for ops. Shared by requestPayout and
 * the daily automatic payout (payouts/autoPayout.ts), so both run the same
 * open-request cap, 24-hour senior-approval threshold and ledger entry.
 * Callers have already checked the merchant, the amount and, for a manual
 * request, the PIN.
 */
export async function createPayoutRequest(
  db: FirebaseFirestore.Firestore,
  merchantId: string,
  merchant: User,
  input: PayoutInput
): Promise<{ payoutId: string }> {
  const { amountCents, route } = input;
  const currency: Currency = input.currency ?? "USD";
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
    const { floatApprovalThresholdCents, slsPerUsd } = await getRates();
    // Every payout counts in dollars towards the threshold, shillings at the
    // limits rate, so switching currency doesn't reset the total.
    const asCents = (amount: number, c: unknown) =>
      toLimitCents(amount, parseCurrency(c) ?? "USD", slsPerUsd);

    const payoutRef = db.collection(PAYOUT_REQUESTS_COLLECTION).doc();
    const holdEntryId = `payout_hold_${payoutRef.id}`;
    const now = admin.firestore.Timestamp.now();

    try {
      await db.runTransaction(async (tx) => {
        // The merchant's payouts over the last 24 hours count towards the
        // threshold, so three $200 requests are treated like one $600 one.
        // Read in the transaction so simultaneous requests can't each see
        // the others missing.
        const recent = await tx.get(
          db
            .collection(PAYOUT_REQUESTS_COLLECTION)
            .where("merchantId", "==", merchantId)
            .where("createdAt", ">=", rollingWindowStart(now.toMillis()))
        );
        const requiresSeniorApproval =
          sumStandingCents(recent.docs, undefined, (d) => asCents(d.amountCents, d.currency)) +
            asCents(amountCents, currency) >=
          floatApprovalThresholdCents;

        const prepared = await prepareJournalEntry(tx, {
          entryId: holdEntryId,
          type: "payout_hold",
          currency,
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
          ...(currency === "USD" ? {} : { currency }),
          route,
          destinationName: input.destinationName,
          destinationRef: input.destinationRef,
          ...(typeof input.note === "string" && input.note.trim()
            ? { note: input.note.trim().slice(0, 200) }
            : {}),
          ...(input.auto ? { auto: true } : {}),
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
          kind: "payout",
          fromUserId: merchantId,
          toUserId: "system",
          participants: [merchantId],
          amount: amountCents,
          currency,
          status: "pending",
          description: input.auto ? `Automatic payout (${route})` : `Payout requested (${route})`,
          journalEntryId: holdEntryId,
          createdAt: now,
        };
        tx.set(db.collection("transactions").doc(holdEntryId), txRecord);
      });
    } catch (error: any) {
      if (error instanceof InsufficientBalanceError) {
        throw new https.HttpsError(
          "failed-precondition",
          currency === "USD"
            ? "You don't have that much in your balance"
            : "You don't have that many shillings in your balance"
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


  return { payoutId: payoutRef.id };
}

export const requestPayout = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<RequestPayoutInput>
  ): Promise<ApiResponse<{ payoutId: string; amountCents: number; currency: Currency }>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const { amountCents, note, pin } = request.data ?? ({} as RequestPayoutInput);

    if (!pin) {
      throw new https.HttpsError("invalid-argument", "PIN is required");
    }
    const currency = parseCurrency(request.data?.currency);
    if (!currency) {
      throw new https.HttpsError("invalid-argument", "Currency must be USD or SLS");
    }
    // The limits are dollars; a shilling amount counts at the limits rate.
    const limitCents =
      typeof amountCents !== "number" || !Number.isInteger(amountCents)
        ? 0
        : currency === "USD"
          ? amountCents
          : toLimitCents(amountCents, currency, (await getRates()).slsPerUsd);
    if (limitCents < MIN_PAYOUT_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `Payouts start at $${MIN_PAYOUT_CENTS / 100}`,
        { reason: "below_min" }
      );
    }
    if (limitCents > MAX_PAYOUT_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `A single payout is capped at $${MAX_PAYOUT_CENTS / 100}`,
        { reason: "above_max" }
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

    const { zaadChangeHoldHours } = await getRates();
    const block = zaadPayoutBlock(merchant, zaadChangeHoldHours, Date.now());
    if (block) {
      throw new https.HttpsError("failed-precondition", zaadPayoutBlockMessage(block, zaadChangeHoldHours));
    }
    const zaad = merchant.zaad!;

    // The payout debits the merchant's own wallet, so it is a user-initiated
    // debit and takes a PIN like every other one.
    const pinValid = await verifyUserPin(merchantId, pin);
    if (!pinValid) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    // Outgoing money waits out the pause after a PIN reset.
    await assertResetCooldownAllows(merchantId, "other", 0);

    const { payoutId } = await createPayoutRequest(db, merchantId, merchant, {
      amountCents,
      currency,
      route: "zaad",
      destinationName: zaad.name,
      destinationRef: zaad.msisdn,
      ...(typeof note === "string" && note.trim() ? { note } : {}),
    });

    return {
      success: true,
      message: `Requested — we'll send ${formatAmount(amountCents, currency)} to ${zaadLabel(zaad.msisdn)} and confirm here`,
      data: { payoutId, amountCents, currency },
    };
  }
);
