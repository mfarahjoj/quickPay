/**
 * Adjustment desk — how ops correct a balance.
 *
 * Until now the ledger desk could find drift but nothing could fix it: a
 * correction needed a hand-written prod script. An adjustment is an ordinary
 * balanced journal entry (type `adjustment`) moving value between two named
 * accounts, so it shows up in the books, the invariant check and the
 * customer's history like any other movement. Balances are never edited.
 *
 * Guards:
 * - ops or super, recent sign-in, a reason, an idempotency key from the
 *   console so a retried click posts once;
 * - holds are off limits — cash-out and settlement holds have their own flows;
 * - above the float threshold, counted over 24 hours for the accounts
 *   involved, only a super admin may post, the same seniority rule as payouts;
 * - a frozen wallet may be debited: taking back value a suspect account
 *   should never have had is exactly what freezing is for.
 *
 * `prepareAdjustment` is shared with dispute resolution, which posts its
 * remedies through the same path.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, Transaction } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { getRates } from "../config/rates";
import { notifyUser } from "../utils/notifications";
import { requireIdempotencyKey } from "../utils/idempotency";
import { rollingWindowStart } from "../utils/rollingTotal";
import {
  prepareJournalEntry,
  isValidAccount,
  isUserAccount,
  userIdOf,
  CASHOUT_HOLD,
  SETTLEMENT_HOLD,
  InsufficientBalanceError,
  WalletNotFoundError,
} from "../ledger";

export const ADJUSTMENTS_COLLECTION = "adjustments";

/** A typo should not become a five-figure correction. */
const MAX_ADJUSTMENT_CENTS = 100_000_00;

/** Accounts with their own flows, which an adjustment must not touch. */
const OFF_LIMITS = [CASHOUT_HOLD, SETTLEMENT_HOLD];

export interface AdjustmentDoc {
  debitAccount: string;
  creditAccount: string;
  amountCents: number;
  reason: string;
  postedBy: string;
  postedByEmail?: string;
  journalEntryId: string;
  transactionId: string;
  disputeId?: string;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface AdjustmentInput {
  adjustmentId: string;
  debitAccount: string;
  creditAccount: string;
  amountCents: number;
  reason: string;
  postedBy: string;
  postedByEmail?: string;
  disputeId?: string;
  /** Shown to the user in their history. */
  description?: string;
  /** Settling a lost dispute out of the reserve it created (D8). */
  useReserved?: boolean;
}

export interface PreparedAdjustment {
  /** True if this adjustment id was already posted; write() is a no-op. */
  alreadyPosted: boolean;
  journalEntryId: string;
  transactionId: string;
  /** Users whose wallets this moves, for notifications. */
  userIds: string[];
  write(tx: FirebaseFirestore.Transaction): void;
}

/** Throws unless the two accounts may be adjusted against each other. */
export function assertAdjustableAccounts(debitAccount: unknown, creditAccount: unknown): void {
  for (const account of [debitAccount, creditAccount]) {
    if (typeof account !== "string" || !isValidAccount(account)) {
      throw new https.HttpsError("invalid-argument", `Not a ledger account: ${String(account)}`);
    }
    if (OFF_LIMITS.includes(account)) {
      throw new https.HttpsError(
        "invalid-argument",
        `${account} is settled by its own flow and can't be adjusted`
      );
    }
  }
  if (debitAccount === creditAccount) {
    throw new https.HttpsError("invalid-argument", "Debit and credit accounts must differ");
  }
}

/**
 * Reads only. Stage with `write(tx)` inside the caller's transaction, after
 * the caller's own reads.
 */
export async function prepareAdjustment(
  tx: FirebaseFirestore.Transaction,
  input: AdjustmentInput
): Promise<PreparedAdjustment> {
  const db = admin.firestore();
  const adjustmentRef = db.collection(ADJUSTMENTS_COLLECTION).doc(input.adjustmentId);
  const journalEntryId = `adjustment_${input.adjustmentId}`;
  const transactionId = journalEntryId;
  const userIds = [input.debitAccount, input.creditAccount]
    .filter(isUserAccount)
    .map(userIdOf);

  const existing = await tx.get(adjustmentRef);
  if (existing.exists) {
    return { alreadyPosted: true, journalEntryId, transactionId, userIds, write: () => undefined };
  }

  const prepared = await prepareJournalEntry(tx, {
    entryId: journalEntryId,
    type: "adjustment",
    currency: "USD",
    lines: [
      { account: input.debitAccount, debit: input.amountCents, credit: 0 },
      { account: input.creditAccount, debit: 0, credit: input.amountCents },
    ],
    refs: {
      adjustmentId: input.adjustmentId,
      transactionId,
      ...(input.disputeId ? { disputeId: input.disputeId } : {}),
    },
    description: input.description ?? "Correction by Zapp Pay",
    postedBy: input.postedBy,
    allowFrozenDebit: true,
    ...(input.useReserved ? { useReserved: true } : {}),
  });

  return {
    alreadyPosted: false,
    journalEntryId,
    transactionId,
    userIds,
    write(t) {
      const now = admin.firestore.Timestamp.now();
      prepared.write(t);

      const doc: AdjustmentDoc = {
        debitAccount: input.debitAccount,
        creditAccount: input.creditAccount,
        amountCents: input.amountCents,
        reason: input.reason,
        postedBy: input.postedBy,
        ...(input.postedByEmail ? { postedByEmail: input.postedByEmail } : {}),
        journalEntryId,
        transactionId,
        ...(input.disputeId ? { disputeId: input.disputeId } : {}),
        createdAt: now,
      };
      t.create(adjustmentRef, doc);

      // Only users see transaction rows; a platform-to-float correction needs none.
      if (userIds.length > 0) {
        const row: Transaction = {
          type: "adjustment",
          kind: "adjustment",
          fromUserId: isUserAccount(input.debitAccount) ? userIdOf(input.debitAccount) : "system",
          toUserId: isUserAccount(input.creditAccount) ? userIdOf(input.creditAccount) : "system",
          participants: userIds,
          amount: input.amountCents,
          currency: "USD",
          status: "completed",
          description: input.description ?? "Correction by Zapp Pay",
          journalEntryId,
          adjustmentId: input.adjustmentId,
          ...(input.disputeId ? { disputeId: input.disputeId } : {}),
          createdAt: now,
          completedAt: now,
        };
        t.set(db.collection("transactions").doc(transactionId), row);
      }
    },
  };
}

/** Tell each wallet holder what moved. Fire and forget. */
export function notifyAdjustment(
  debitAccount: string,
  creditAccount: string,
  amountCents: number
): void {
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  if (isUserAccount(creditAccount)) {
    notifyUser(
      userIdOf(creditAccount),
      "adjustment_posted",
      { key: "adjustment.credit", params: { amount } },
      { type: "adjustment_posted", amount: String(amountCents) }
    ).catch((err) => console.error("Failed to notify adjustment credit:", err));
  }
  if (isUserAccount(debitAccount)) {
    notifyUser(
      userIdOf(debitAccount),
      "adjustment_posted",
      { key: "adjustment.debit", params: { amount } },
      { type: "adjustment_posted", amount: String(-amountCents) }
    ).catch((err) => console.error("Failed to notify adjustment debit:", err));
  }
}

interface PostAdjustmentRequest {
  debitAccount: string;
  creditAccount: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}

interface PostAdjustmentResponse {
  adjustmentId: string;
  journalEntryId: string;
  alreadyPosted: boolean;
  auditId?: string;
}

export const adminPostAdjustment = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<PostAdjustmentRequest>
  ): Promise<ApiResponse<PostAdjustmentResponse>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const key = requireIdempotencyKey(request.data?.idempotencyKey);
    const { debitAccount, creditAccount, amountCents } = request.data ?? ({} as PostAdjustmentRequest);

    assertAdjustableAccounts(debitAccount, creditAccount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new https.HttpsError("invalid-argument", "amountCents must be a positive integer");
    }
    if (amountCents > MAX_ADJUSTMENT_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `A single adjustment is capped at $${MAX_ADJUSTMENT_CENTS / 100}`
      );
    }

    const db = admin.firestore();
    const adjustmentId = `${actor.uid}_${key}`;

    // Seniority over the last 24 hours for these accounts, so a large
    // correction can't be posted by ops as several small ones.
    const { floatApprovalThresholdCents } = await getRates();
    const recent = await db
      .collection(ADJUSTMENTS_COLLECTION)
      .where("createdAt", ">=", rollingWindowStart())
      .get();
    const touched = new Set([debitAccount, creditAccount]);
    const recentCents = recent.docs
      .filter((d) => d.id !== adjustmentId)
      .map((d) => d.data() as AdjustmentDoc)
      .filter((a) => touched.has(a.debitAccount) || touched.has(a.creditAccount))
      .reduce((sum, a) => sum + a.amountCents, 0);
    if (recentCents + amountCents >= floatApprovalThresholdCents && !actor.roles.includes("super")) {
      throw new https.HttpsError(
        "permission-denied",
        "Corrections this large need a senior admin",
        { reason: "needs_super", recentCents }
      );
    }

    try {
      const result = await db.runTransaction(async (tx) => {
        const prepared = await prepareAdjustment(tx, {
          adjustmentId,
          debitAccount,
          creditAccount,
          amountCents,
          reason,
          postedBy: actor.uid,
          postedByEmail: actor.email,
        });
        if (prepared.alreadyPosted) return { prepared };

        prepared.write(tx);
        const auditId = stageAuditEntry(tx, {
          actor,
          action: "ledger.adjust",
          target: { type: "adjustment", id: adjustmentId },
          reason,
          after: { debitAccount, creditAccount, amountCents },
          journalEntryId: prepared.journalEntryId,
        });
        return { prepared, auditId };
      });

      if (!result.prepared.alreadyPosted) {
        notifyAdjustment(debitAccount, creditAccount, amountCents);
      }

      return {
        success: true,
        message: result.prepared.alreadyPosted ? "Already posted" : "Adjustment posted",
        data: {
          adjustmentId,
          journalEntryId: result.prepared.journalEntryId,
          alreadyPosted: result.prepared.alreadyPosted,
          ...(result.auditId ? { auditId: result.auditId } : {}),
        },
      };
    } catch (error: any) {
      if (error instanceof InsufficientBalanceError) {
        throw new https.HttpsError(
          "failed-precondition",
          `${error.account} doesn't have that much; a wallet can't go below zero`
        );
      }
      if (error instanceof WalletNotFoundError) {
        throw new https.HttpsError("not-found", `No wallet for ${error.account}`);
      }
      if (error instanceof https.HttpsError) throw error;
      console.error("Adjustment failed:", error);
      throw new https.HttpsError("internal", "Could not post the adjustment");
    }
  }
);

/** The latest adjustments, for the console. */
export const adminListAdjustments = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ limit?: number }>
  ): Promise<ApiResponse<{ adjustments: Array<AdjustmentDoc & { id: string; createdAtMs: number }> }>> => {
    requireAdmin(request, ["ops", "super", "compliance"]);
    const limit = Math.min(Math.max(Number(request.data?.limit) || 50, 1), 200);
    const snap = await admin
      .firestore()
      .collection(ADJUSTMENTS_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return {
      success: true,
      data: {
        adjustments: snap.docs.map((d) => {
          const a = d.data() as AdjustmentDoc;
          return { ...a, id: d.id, createdAtMs: a.createdAt.toMillis() };
        }),
      },
    };
  }
);
