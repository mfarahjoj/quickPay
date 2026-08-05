/**
 * postJournalEntry — the single choke-point through which all money moves.
 *
 * Firestore transactions require every read to happen before any write, and
 * callers need their own reads/writes (QR status, transaction rows) in the
 * same atomic unit, so posting is split in two:
 *
 *   const pending = await prepareJournalEntry(tx, input);  // reads only
 *   ...caller's remaining reads...
 *   pending.write(tx);                                     // writes only
 *   ...caller's remaining writes...
 *
 * Idempotency: the entry doc ID is the idempotency key. prepare() detects an
 * already-posted entry (`alreadyPosted: true`, write() becomes a no-op) and
 * write() uses create() semantics, so a concurrent duplicate fails the whole
 * transaction rather than double-posting.
 */

import * as admin from "firebase-admin";
import { Wallet } from "../types";
import { JournalEntryDoc, JournalEntryInput, JournalRefs } from "./types";
import { enforcesNonNegative, isUserAccount, userIdOf } from "./accounts";
import { AccountDelta, aggregateDeltas, validateEntry } from "./validate";

export const JOURNAL_COLLECTION = "journal_entries";
export const LEDGER_BALANCES_COLLECTION = "ledger_balances";

/** Thrown when a debit would take a user wallet below zero. */
export class InsufficientBalanceError extends Error {
  readonly account: string;
  constructor(account: string) {
    super("Insufficient balance");
    this.name = "InsufficientBalanceError";
    this.account = account;
  }
}

/**
 * Thrown when an entry would debit a frozen wallet.
 *
 * This is the un-bypassable half of freeze enforcement: callables check
 * account status up front for a friendly error, but a call site that forgets
 * still cannot move value out of a frozen account, because every debit passes
 * through here.
 *
 * Credits are deliberately allowed. Freezing exists to stop value *leaving* a
 * compromised or suspicious account; blocking incoming legs too would strand
 * in-flight reversals — a cash-out hold returned after expiry, or a merchant
 * refunding a customer who was frozen in the meantime — with no way to settle
 * them short of unfreezing. Business rules about who may *receive* belong in
 * the callables, where the context to explain the rejection exists.
 */
export class FrozenAccountError extends Error {
  readonly account: string;
  constructor(account: string) {
    super("Account is frozen");
    this.name = "FrozenAccountError";
    this.account = account;
  }
}

/** Thrown when a `user:{uid}` line references a missing wallet doc. */
export class WalletNotFoundError extends Error {
  readonly account: string;
  constructor(account: string) {
    super(`Wallet not found for ${account}`);
    this.name = "WalletNotFoundError";
    this.account = account;
  }
}

export interface PreparedJournalEntry {
  /** True if this entryId was already posted; write() is then a no-op. */
  alreadyPosted: boolean;
  /** Balances after this entry, keyed by account (user accounts only). */
  resultingBalances: Map<string, number>;
  /** Stage all ledger writes on the transaction. Call exactly once. */
  write(tx: FirebaseFirestore.Transaction): void;
}

/**
 * Validates the entry, checks idempotency, reads the affected user wallets
 * and enforces the no-overdraft rule. Performs reads only.
 */
export async function prepareJournalEntry(
  tx: FirebaseFirestore.Transaction,
  input: JournalEntryInput
): Promise<PreparedJournalEntry> {
  validateEntry(input);
  const db = admin.firestore();
  const deltas = aggregateDeltas(input.lines);

  const entryRef = db.collection(JOURNAL_COLLECTION).doc(input.entryId);
  const entrySnap = await tx.get(entryRef);
  if (entrySnap.exists) {
    return {
      alreadyPosted: true,
      resultingBalances: new Map(),
      write: () => undefined,
    };
  }

  // Read current balances for user accounts (their projection needs a
  // read-modify-write; non-user accounts use blind increments instead).
  const userDeltas = deltas.filter((d) => isUserAccount(d.account));
  const walletSnaps = await Promise.all(
    userDeltas.map((d) =>
      tx.get(db.collection("wallets").doc(userIdOf(d.account)))
    )
  );

  const resultingBalances = new Map<string, number>();
  userDeltas.forEach((d, i) => {
    const snap = walletSnaps[i];
    if (!snap.exists) {
      throw new WalletNotFoundError(d.account);
    }
    const wallet = snap.data() as Wallet;

    // Frozen accounts may still receive (see FrozenAccountError) but never spend.
    if (d.debits > 0 && wallet.frozen === true) {
      throw new FrozenAccountError(d.account);
    }

    const newBalance = wallet.balance + d.delta;
    if (newBalance < 0 && enforcesNonNegative(d.account)) {
      throw new InsufficientBalanceError(d.account);
    }
    resultingBalances.set(d.account, newBalance);
  });

  const writeEntry = (transaction: FirebaseFirestore.Transaction) => {
    const now = admin.firestore.Timestamp.now();

    // Firestore rejects undefined map values; keep only the refs that are set.
    const refs: JournalRefs = {};
    for (const [key, value] of Object.entries(input.refs ?? {})) {
      if (value !== undefined) (refs as Record<string, string>)[key] = value;
    }

    const entryDoc: JournalEntryDoc = {
      type: input.type,
      currency: input.currency,
      lines: input.lines,
      refs,
      description: input.description,
      postedBy: input.postedBy,
      postedAt: now,
    };
    transaction.create(entryRef, entryDoc);

    userDeltas.forEach((d, i) => {
      const wallet = walletSnaps[i].data() as Wallet;
      transaction.update(db.collection("wallets").doc(userIdOf(d.account)), {
        balance: resultingBalances.get(d.account),
        totalSent: wallet.totalSent + d.debits,
        totalReceived: wallet.totalReceived + d.credits,
        lastTransactionAt: now,
        updatedAt: now,
      });
    });

    for (const d of deltas) {
      if (isUserAccount(d.account)) continue;
      writeNonUserProjection(transaction, d, input.currency, now);
    }
  };

  return { alreadyPosted: false, resultingBalances, write: writeEntry };
}

function writeNonUserProjection(
  tx: FirebaseFirestore.Transaction,
  d: AccountDelta,
  currency: string,
  now: FirebaseFirestore.Timestamp
): void {
  if (d.delta === 0) return;
  const ref = admin
    .firestore()
    .collection(LEDGER_BALANCES_COLLECTION)
    .doc(d.account);
  tx.set(
    ref,
    {
      account: d.account,
      balance: admin.firestore.FieldValue.increment(d.delta),
      currency,
      updatedAt: now,
    },
    { merge: true }
  );
}
