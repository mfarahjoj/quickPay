/**
 * Move to float (AGENT_FLOAT_SEPARATION.md, rule 4): an agent tops up their
 * float from their own sales or earnings, user:{uid} → agent:{uid}.
 *
 * Nothing is created: it is the agent's own money changing purpose, the way
 * a shop-agent rebalances without a trip to ops. The reverse is deliberately
 * not here: float leaves only through the ops float desk's withdraw, which is
 * reconciled against cash actually handed over (rule 5). A wallet's dispute
 * reserve (D8) still applies, so money owed can't be moved out of reach.
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

const MAX_MOVE_CENTS = 100_000_00;

interface MoveToFloatRequest {
  amountCents: number;
  pin: string;
  idempotencyKey: string;
}

export const moveToFloat = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<MoveToFloatRequest>
  ): Promise<ApiResponse<{ floatCents: number; walletCents: number }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const { amountCents, pin } = request.data ?? ({} as MoveToFloatRequest);
    const key = requireIdempotencyKey(request.data?.idempotencyKey);
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_MOVE_CENTS) {
      throw new https.HttpsError("invalid-argument", "Enter an amount to move");
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

    const entryId = scopedEntryId("floatmove", uid, key);
    try {
      const result = await db.runTransaction(async (tx) => {
        const pending = await prepareJournalEntry(tx, {
          entryId,
          type: "float_move",
          currency: "USD",
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
            currency: "USD",
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
        const [w, f] = await Promise.all([db.collection("wallets").doc(uid).get(), readFloatCents(uid)]);
        result.walletCents = (w.data()?.balance as number | undefined) ?? 0;
        result.floatCents = f;
      }
      return { success: true, message: "Moved to float", data: result };
    } catch (error: any) {
      if (error instanceof InsufficientBalanceError) {
        throw new https.HttpsError("failed-precondition", "You don't have that much in sales and earnings", {
          reason: "insufficient_balance",
        });
      }
      throw error;
    }
  }
);
