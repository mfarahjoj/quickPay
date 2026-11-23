/**
 * Move to float (AGENT_FLOAT_SEPARATION.md, rule 4): an agent tops up their
 * float from their own sales or earnings, user:{uid} → agent:{uid}.
 *
 * Nothing is created: it is the agent's own money changing purpose, the way
 * a shop-agent rebalances without a trip to ops. The reverse is deliberately
 * not here: float leaves only through the ops float desk's withdraw, which is
 * reconciled against cash actually handed over (rule 5). A wallet's dispute
 * reserve (D8) still applies, so money owed can't be moved out of reach.
 *
 * In dollars or shillings (SHILLINGS.md): wallet shillings become shilling
 * float (agent:{uid}@SLS), never converted. An app that sends no currency
 * moves dollars, as it always did.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, Transaction, User } from "../types";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "../auth/validatePin";
import { assertAccountActive } from "../utils/accountStatus";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { isAgentRole } from "../utils/roles";
import { requireIdempotencyKey, scopedEntryId } from "../utils/idempotency";
import { prepareJournalEntry, userAccount, agentAccount, InsufficientBalanceError } from "../ledger";
import { readFloatCents } from "./float";
import { getRates } from "../config/rates";
import { formatAmount, parseCurrency, toLimitCents } from "../utils/money";

/** In dollars; a shilling move counts at `slsPerUsd`. */
const MAX_MOVE_CENTS = 100_000_00;

interface MoveToFloatRequest {
  /** In the currency's smallest unit: cents, or whole shillings. */
  amountCents: number;
  /** "USD" (the default) or "SLS". */
  currency?: string;
  pin: string;
  idempotencyKey: string;
}

export const moveToFloat = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<MoveToFloatRequest>
  ): Promise<ApiResponse<{ floatCents: number; walletCents: number; currency: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const { amountCents, pin } = request.data ?? ({} as MoveToFloatRequest);
    const key = requireIdempotencyKey(request.data?.idempotencyKey);
    const currency = parseCurrency(request.data?.currency);
    if (!currency) {
      throw new https.HttpsError("invalid-argument", "Currency must be USD or SLS");
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new https.HttpsError("invalid-argument", "Enter an amount to move");
    }
    const { slsPerUsd } = await getRates();
    if (toLimitCents(amountCents, currency, slsPerUsd) > MAX_MOVE_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `You can move up to ${formatAmount(MAX_MOVE_CENTS, "USD")} at a time`
      );
    }

    const db = admin.firestore();
    const user = (await db.collection("users").doc(uid).get()).data() as User | undefined;
    if (!user || !isAgentRole(user.accountType)) {
      throw new https.HttpsError("permission-denied", "Only agents hold float");
    }
    assertAccountActive(user);
    if (typeof pin !== "string" || !(await verifyUserPin(uid, pin))) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }
    // It leaves the wallet, so it waits out the pause after a PIN reset.
    await assertResetCooldownAllows(uid, "other", 0);

    // The key is scoped by currency too, so the same key can't post a dollar
    // move and then report it as a shilling one.
    const entryId = scopedEntryId(currency === "USD" ? "floatmove" : "floatmove_sls", uid, key);
    try {
      const result = await db.runTransaction(async (tx) => {
        const pending = await prepareJournalEntry(tx, {
          entryId,
          type: "float_move",
          currency,
          lines: [
            { account: userAccount(uid), debit: amountCents, credit: 0 },
            { account: agentAccount(uid), debit: 0, credit: amountCents },
          ],
          refs: { transactionId: entryId },
          description: "Moved to float",
          postedBy: uid,
        });
        if (!pending.alreadyPosted) {
          pending.write(tx);
          const now = admin.firestore.Timestamp.now();
          const row: Transaction = {
            type: "topup",
            kind: "float",
            fromUserId: uid,
            toUserId: uid,
            participants: [uid],
            amount: amountCents,
            currency,
            status: "completed",
            description: "Moved to float",
            journalEntryId: entryId,
            createdAt: now,
            completedAt: now,
          };
          tx.set(db.collection("transactions").doc(entryId), row);
        }
        return {
          floatCents: pending.resultingBalances.get(agentAccount(uid)) ?? -1,
          walletCents: pending.resultingBalances.get(userAccount(uid)) ?? -1,
        };
      });
      // A retry of a move that already posted reports today's balances.
      if (result.floatCents < 0 || result.walletCents < 0) {
        const [w, f] = await Promise.all([
          db.collection("wallets").doc(uid).get(),
          readFloatCents(uid, undefined, currency),
        ]);
        const balance = currency === "USD" ? w.data()?.balance : w.data()?.sls?.balance;
        result.walletCents = (balance as number | undefined) ?? 0;
        result.floatCents = f;
      }
      return { success: true, message: "Moved to float", data: { ...result, currency } };
    } catch (error: any) {
      if (error instanceof InsufficientBalanceError) {
        const what = currency === "USD" ? "sales and earnings" : "shillings in your sales and earnings";
        throw new https.HttpsError("failed-precondition", `You don't have that much in ${what}`, {
          reason: "insufficient_balance",
        });
      }
      throw error;
    }
  }
);
