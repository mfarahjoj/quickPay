/**
 * Top-up desk — how ops credit a wallet with money Zapp has really received.
 *
 * A customer pays Zapp's Zaad or eDahab number, or the bank account, outside
 * the automatic flows (a different sender, a business transfer), and ops
 * credit the wallet by hand. Unlike an adjustment, which corrects a mistake
 * and may draw on fees or promo, a top-up always comes out of the float
 * account the money arrived in, carries that rail's reference, and reads as
 * a top-up in the customer's history.
 *
 * One currency per top-up, never converted: shillings land in the wallet's
 * shilling pocket from `float:<rail>@SLS`, dollars in the dollar balance.
 *
 * Guards, as for adjustments: ops or super, recent sign-in, a reason, an
 * idempotency key from the console, a cap, and a senior admin above the float
 * threshold counted over 24 hours for the same wallet. A frozen wallet is
 * refused: crediting a suspect account is a decision to unfreeze it first.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, Transaction, TransactionKind } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { getRates } from "../config/rates";
import { notifyTopupCompleted } from "../utils/notifications";
import { requireIdempotencyKey } from "../utils/idempotency";
import { rollingWindowStart } from "../utils/rollingTotal";
import {
  prepareJournalEntry,
  userAccount,
  FLOAT_ZAAD,
  FLOAT_EDAHAB,
  FLOAT_BANK,
  WalletNotFoundError,
  type LedgerCurrency,
} from "../ledger";
import { parseCurrency, toLimitCents } from "../utils/money";

export const ADMIN_TOPUPS_COLLECTION = "admin_topups";

/** The same ceiling as an adjustment: a typo must not become $100,000. */
const MAX_TOPUP_CENTS = 100_000_00;

export type TopupSource = "zaad" | "edahab" | "bank";

const SOURCES: Record<TopupSource, { account: string; label: string; kind: TransactionKind }> = {
  zaad: { account: FLOAT_ZAAD, label: "Zaad", kind: "mobile_money_topup" },
  edahab: { account: FLOAT_EDAHAB, label: "eDahab", kind: "mobile_money_topup" },
  bank: { account: FLOAT_BANK, label: "Bank", kind: "bank_topup" },
};

export interface AdminTopupDoc {
  uid: string;
  /** In the currency's smallest unit: cents, or whole shillings. */
  amountCents: number;
  currency: LedgerCurrency;
  source: TopupSource;
  /** The rail's own ID for the payment: Zaad/eDahab transaction ID, bank ref. */
  reference: string;
  reason: string;
  postedBy: string;
  postedByEmail?: string;
  journalEntryId: string;
  transactionId: string;
  createdAt: FirebaseFirestore.Timestamp;
}

interface TopupRequest {
  uid: string;
  amountCents: number;
  currency?: string;
  source: string;
  reference: string;
  reason: string;
  idempotencyKey: string;
}

function requireReference(value: unknown): string {
  const ref = typeof value === "string" ? value.trim() : "";
  if (ref.length < 3 || ref.length > 64) {
    throw new https.HttpsError(
      "invalid-argument",
      "The payment's reference (3 to 64 characters) is required"
    );
  }
  return ref;
}

export const adminTopupWallet = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<TopupRequest>
  ): Promise<ApiResponse<{ topupId: string; journalEntryId: string; alreadyPosted: boolean }>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const key = requireIdempotencyKey(request.data?.idempotencyKey);
    const reference = requireReference(request.data?.reference);

    const uid = typeof request.data?.uid === "string" ? request.data.uid.trim() : "";
    if (!uid || uid.includes("/")) {
      throw new https.HttpsError("invalid-argument", "uid is required");
    }
    const sourceKey = request.data?.source as TopupSource;
    const source = SOURCES[sourceKey];
    if (!source) {
      throw new https.HttpsError("invalid-argument", "source must be zaad, edahab or bank");
    }
    const currency = parseCurrency(request.data?.currency);
    if (!currency) {
      throw new https.HttpsError("invalid-argument", "currency must be USD or SLS");
    }
    const amountCents = request.data?.amountCents;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new https.HttpsError("invalid-argument", "amountCents must be a positive integer");
    }

    // The cap and the senior threshold are dollars; shillings count at the rate.
    const { floatApprovalThresholdCents, slsPerUsd } = await getRates();
    const asCents = (amount: number, c: LedgerCurrency) => toLimitCents(amount, c, slsPerUsd);
    if (asCents(amountCents, currency) > MAX_TOPUP_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `A single top-up is capped at $${(MAX_TOPUP_CENTS / 100).toLocaleString("en-US")}`
      );
    }

    const db = admin.firestore();
    const topupId = `${actor.uid}_${key}`;
    const journalEntryId = `admin_topup_${topupId}`;
    const transactionId = journalEntryId;
    const topupRef = db.collection(ADMIN_TOPUPS_COLLECTION).doc(topupId);

    // Seniority over the last 24 hours for this wallet, so a large top-up
    // can't be posted by ops as several small ones.
    const recent = await db
      .collection(ADMIN_TOPUPS_COLLECTION)
      .where("uid", "==", uid)
      .where("createdAt", ">=", rollingWindowStart())
      .get();
    const recentCents = recent.docs
      .filter((d) => d.id !== topupId)
      .map((d) => d.data() as AdminTopupDoc)
      .reduce((sum, t) => sum + asCents(t.amountCents, t.currency), 0);
    if (
      recentCents + asCents(amountCents, currency) >= floatApprovalThresholdCents &&
      !actor.roles.includes("super")
    ) {
      throw new https.HttpsError("permission-denied", "Top-ups this large need a senior admin", {
        reason: "needs_super",
        recentCents,
      });
    }

    const description = `${source.label} top-up`;

    try {
      const result = await db.runTransaction(async (tx) => {
        const existing = await tx.get(topupRef);
        if (existing.exists) return { alreadyPosted: true };

        const walletSnap = await tx.get(db.collection("wallets").doc(uid));
        if (!walletSnap.exists) throw new WalletNotFoundError(userAccount(uid));
        if (walletSnap.get("frozen") === true) {
          throw new https.HttpsError(
            "failed-precondition",
            "This wallet is frozen. Unfreeze it before topping it up."
          );
        }

        const prepared = await prepareJournalEntry(tx, {
          entryId: journalEntryId,
          type: "admin_topup",
          currency,
          lines: [
            { account: source.account, debit: amountCents, credit: 0 },
            { account: userAccount(uid), debit: 0, credit: amountCents },
          ],
          refs: { topupId, transactionId },
          description,
          postedBy: actor.uid,
        });
        if (prepared.alreadyPosted) return { alreadyPosted: true };

        prepared.write(tx);
        const now = admin.firestore.Timestamp.now();
        const doc: AdminTopupDoc = {
          uid,
          amountCents,
          currency,
          source: sourceKey,
          reference,
          reason,
          postedBy: actor.uid,
          ...(actor.email ? { postedByEmail: actor.email } : {}),
          journalEntryId,
          transactionId,
          createdAt: now,
        };
        tx.create(topupRef, doc);

        const row: Transaction = {
          type: "topup",
          kind: source.kind,
          fromUserId: sourceKey,
          toUserId: uid,
          participants: [uid],
          amount: amountCents,
          currency,
          status: "completed",
          description,
          reference,
          journalEntryId,
          createdAt: now,
          completedAt: now,
        };
        tx.set(db.collection("transactions").doc(transactionId), row);

        stageAuditEntry(tx, {
          actor,
          action: "wallet.topup",
          target: { type: "user", id: uid },
          reason,
          after: { amountCents, currency, source: sourceKey, reference },
          journalEntryId,
        });
        return { alreadyPosted: false };
      });

      if (!result.alreadyPosted) {
        notifyTopupCompleted(uid, amountCents, currency, sourceKey).catch((err) =>
          console.error("Failed to notify admin top-up:", err)
        );
      }

      return {
        success: true,
        message: result.alreadyPosted ? "Already posted" : "Wallet topped up",
        data: { topupId, journalEntryId, alreadyPosted: result.alreadyPosted },
      };
    } catch (error: any) {
      if (error instanceof WalletNotFoundError) {
        throw new https.HttpsError("not-found", "This account has no wallet");
      }
      if (error instanceof https.HttpsError) throw error;
      console.error("Admin top-up failed:", error);
      throw new https.HttpsError("internal", "Could not top up the wallet");
    }
  }
);

/** The latest top-ups, for the console. */
export const adminListTopups = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ limit?: number }>
  ): Promise<ApiResponse<{ topups: Array<AdminTopupDoc & { id: string; createdAtMs: number; name?: string }> }>> => {
    requireAdmin(request, ["ops", "super", "compliance"]);
    const limit = Math.min(Math.max(Number(request.data?.limit) || 30, 1), 100);
    const db = admin.firestore();
    const snap = await db
      .collection(ADMIN_TOPUPS_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    const rows = snap.docs.map((d) => ({ ...(d.data() as AdminTopupDoc), id: d.id }));
    const uids = [...new Set(rows.map((r) => r.uid))];
    const users = uids.length
      ? await db.getAll(...uids.map((u) => db.collection("users").doc(u)))
      : [];
    const names = new Map(users.map((u) => [u.id, u.get("fullName") as string | undefined]));
    return {
      success: true,
      data: {
        topups: rows.map((r) => ({
          ...r,
          createdAtMs: r.createdAt.toMillis(),
          ...(names.get(r.uid) ? { name: names.get(r.uid) } : {}),
        })),
      },
    };
  }
);
