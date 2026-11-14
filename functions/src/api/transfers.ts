/**
 * Transfers: a partner pays a Zapp account out of its own wallet.
 *
 *   POST /v1/transfers           {amount, currency, destination_phone, reference?, metadata?}
 *   GET  /v1/transfers/:id
 *   GET  /v1/accounts/lookup?phone=
 *
 * Built for Ridy paying drivers their share of a fare minutes after the rider
 * paid. A transfer settles inside the request: the response says `succeeded`
 * (money moved) or `failed` (the recipient cannot receive; nothing moved).
 * There are no transfer webhooks — there is nothing left to tell later.
 *
 * Refusals that might pass on a retry — too little balance, a cap reached, a
 * frozen partner — are errors and record nothing, so the partner retries with
 * the same Idempotency-Key and can never pay twice. A `failed` transfer is
 * final for its key: fix the number and send a new key.
 *
 * Money moves only when the caller is a partner and the key has the
 * `transfers` scope (partners.ts). Each transfer is one `payroll` journal
 * entry, partner → recipient, the same shape payrollPayout posts. Transfers
 * carry no fee: Zapp's fee is on the partner's charges.
 *
 * Test keys run the same checks and record a transfer, but look nobody up and
 * post nothing. A destination ending in 0000 fails as `recipient_not_found`,
 * so an integration can exercise that path.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { Transaction, User } from "../types";
import { getRates } from "../config/rates";
import { isAccountActive } from "../utils/accountStatus";
import { validatePhoneNumber } from "../utils/validation";
import { startOfLocalDay } from "../utils/limits";
import { notifyUser } from "../utils/notifications";
import { API_CURRENCY_CODES, Currency, currencyFromApiCode, pushAmount, toLimitCents } from "../utils/money";
import {
  FrozenAccountError,
  InsufficientBalanceError,
  WalletNotFoundError,
  prepareJournalEntry,
  userAccount,
} from "../ledger";
import { ApiCaller } from "./keys";
import { ApiError, badRequest, conflict, notFound } from "./http";
import { parseAmount, parseMetadata, parseOptionalString } from "./charges";
import { enforceApiRateLimit, idempotencyDocId, idempotencyMismatch, requestFingerprint } from "./requestGuards";
import { requireTransferPartner } from "./partners";
import {
  API_IDEMPOTENCY_COLLECTION,
  API_PARTNERS_COLLECTION,
  API_TRANSFERS_COLLECTION,
  ApiIdempotencyRecord,
  ApiTransfer,
  TRANSFER_DAYS_SUBCOLLECTION,
  TransferDay,
  TransferFailureCode,
} from "./types";

export const TRANSFER_ID_PATTERN = /^tr_[A-Za-z0-9_-]{16,64}$/;
const MAX_REFERENCE = 128;
/** Account lookups per key per minute: enough to check numbers as drivers save them, too few to sweep a range. */
export const LOOKUPS_PER_MINUTE = 20;
/** Test destinations ending in this fail as recipient_not_found. */
const TEST_NOT_FOUND_SUFFIX = "0000";

export function newTransferId(): string {
  return `tr_${crypto.randomBytes(18).toString("base64url")}`;
}

/** The partner's local day, "2026-11-13", that a transfer counts against. */
export function transferDayKey(now: Date): string {
  return new Date(startOfLocalDay(now).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

const iso = (ts?: FirebaseFirestore.Timestamp) => (ts ? ts.toDate().toISOString() : null);

export function serializeTransfer(id: string, t: ApiTransfer) {
  return {
    id,
    object: "transfer",
    amount: t.amount,
    currency: API_CURRENCY_CODES[t.currency] ?? t.currency,
    status: t.status,
    failure_code: t.failureCode ?? null,
    destination_phone: t.destinationPhone,
    reference: t.reference ?? null,
    metadata: t.metadata ?? {},
    transaction_id: t.transactionId ?? null,
    created: iso(t.createdAt),
    livemode: t.livemode,
  };
}

export interface NormalisedTransferInput {
  amount: number;
  currency: Currency;
  destinationPhone: string;
  reference?: string;
  metadata?: Record<string, string>;
}

/** A +252 number, or one of the partner's test numbers. */
function parsePhone(value: unknown, param: string, testPhoneNumbers: readonly string[] = []): string {
  if (
    typeof value !== "string" ||
    !(validatePhoneNumber(value.trim()) || testPhoneNumbers.includes(value.trim()))
  ) {
    throw badRequest("phone_invalid", `${param} must be in international format, e.g. +252634123456`, param);
  }
  return value.trim();
}

export function parseTransferInput(
  body: Record<string, unknown>,
  testPhoneNumbers: readonly string[] = []
): NormalisedTransferInput {
  const amount = parseAmount(body.amount);
  // No default: a partner paying in the wrong currency is a real loss, so it says which.
  const currency = currencyFromApiCode(typeof body.currency === "string" ? body.currency.toUpperCase() : body.currency);
  if (!currency) throw badRequest("currency_unsupported", "currency is required: USD or SLSH", "currency");
  return {
    amount,
    currency,
    destinationPhone: parsePhone(body.destination_phone, "destination_phone", testPhoneNumbers),
    reference: parseOptionalString(body.reference, "reference", MAX_REFERENCE),
    metadata: parseMetadata(body.metadata),
  };
}

/** Who a live transfer would pay, or why it can't. */
async function resolveRecipient(
  phone: string,
  merchantId: string
): Promise<{ recipientId: string; user: User } | { failure: TransferFailureCode }> {
  const db = admin.firestore();
  const snap = await db.collection("users").where("phoneNumber", "==", phone).limit(1).get();
  if (snap.empty) return { failure: "recipient_not_found" };
  const doc = snap.docs[0];
  if (doc.id === merchantId) {
    throw badRequest("destination_invalid", "A partner cannot transfer to its own account", "destination_phone");
  }
  const user = doc.data() as User;
  // No wallet yet means no PIN yet: the account exists but cannot hold money.
  const walletSnap = await db.collection("wallets").doc(doc.id).get();
  if (!isAccountActive(user) || !walletSnap.exists) return { failure: "recipient_inactive" };
  return { recipientId: doc.id, user };
}

export interface CreateTransferResult {
  id: string;
  transfer: ApiTransfer;
  replayed: boolean;
}

export async function createTransfer(
  caller: ApiCaller,
  body: Record<string, unknown>,
  idempotencyKey: string
): Promise<CreateTransferResult> {
  const partner = await requireTransferPartner(caller);
  const input = parseTransferInput(body, partner.testPhoneNumbers ?? []);
  const db = admin.firestore();
  const idemRef = db
    .collection(API_IDEMPOTENCY_COLLECTION)
    .doc(idempotencyDocId(caller.merchantId, "transfer", idempotencyKey, caller.livemode));
  const requestHash = requestFingerprint(input);

  const prior = await idemRef.get();
  if (prior.exists) return replayTransfer(prior.data() as ApiIdempotencyRecord, requestHash);

  const { slsPerUsd } = await getRates();
  const usdCents = toLimitCents(input.amount, input.currency, slsPerUsd);
  if (usdCents > partner.maxTransferUsdCents) {
    throw badRequest(
      "amount_over_limit",
      `This transfer is over your per-transfer limit of ${partner.maxTransferUsdCents} US cents`,
      "amount"
    );
  }

  const recipient = !caller.livemode
    ? input.destinationPhone.endsWith(TEST_NOT_FOUND_SUFFIX)
      ? { failure: "recipient_not_found" as const }
      : null
    : await resolveRecipient(input.destinationPhone, caller.merchantId);

  const transferRef = db.collection(API_TRANSFERS_COLLECTION).doc(newTransferId());
  const transactionId = db.collection("transactions").doc().id;
  const journalEntryId = `transfer_${transferRef.id}`;
  const now = admin.firestore.Timestamp.now();
  const dayRef = db
    .collection(API_PARTNERS_COLLECTION)
    .doc(caller.merchantId)
    .collection(TRANSFER_DAYS_SUBCOLLECTION)
    .doc(transferDayKey(now.toDate()));

  const base: ApiTransfer = {
    merchantId: caller.merchantId,
    livemode: caller.livemode,
    keyId: caller.keyId,
    amount: input.amount,
    currency: input.currency,
    status: "succeeded",
    destinationPhone: input.destinationPhone,
    ...(input.reference ? { reference: input.reference } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: now,
  };
  const record: ApiIdempotencyRecord = {
    merchantId: caller.merchantId,
    scope: "transfer",
    requestHash,
    objectId: transferRef.id,
    createdAt: now,
  };

  type Outcome = { replayOf: string } | { transfer: ApiTransfer };
  let outcome: Outcome;
  try {
    outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) {
        const prev = idemSnap.data() as ApiIdempotencyRecord;
        if (prev.requestHash !== requestHash) throw idempotencyMismatch();
        return { replayOf: prev.objectId };
      }

      if (recipient && "failure" in recipient) {
        const transfer: ApiTransfer = { ...base, status: "failed", failureCode: recipient.failure };
        tx.create(transferRef, transfer);
        tx.create(idemRef, record);
        return { transfer };
      }

      if (!recipient) {
        // Test mode: recorded, nothing posted, no daily total.
        tx.create(transferRef, base);
        tx.create(idemRef, record);
        return { transfer: base };
      }

      // The daily total is read and bumped with the entry, so two transfers
      // racing each other can never both fit under the last of the cap.
      const day = ((await tx.get(dayRef)).data() as TransferDay | undefined) ?? { usdCents: 0, count: 0 };
      if (day.usdCents + usdCents > partner.dailyTransferUsdCents) {
        throw conflict(
          "daily_limit_reached",
          `This transfer would pass your daily transfer limit of ${partner.dailyTransferUsdCents} US cents`
        );
      }

      const merchantName = caller.merchant.fullName || "Zapp partner";
      const pending = await prepareJournalEntry(tx, {
        entryId: journalEntryId,
        type: "payroll",
        currency: input.currency,
        lines: [
          { account: userAccount(caller.merchantId), debit: input.amount, credit: 0 },
          { account: userAccount(recipient.recipientId), debit: 0, credit: input.amount },
        ],
        refs: { transactionId, apiTransferId: transferRef.id },
        description: input.reference || `Transfer from ${merchantName}`,
        postedBy: caller.merchantId,
      });
      if (pending.alreadyPosted) {
        throw conflict("transfer_conflict", "Could not record this transfer. Retry the request.");
      }
      pending.write(tx);

      const row: Transaction = {
        type: "payment",
        kind: "payroll",
        fromUserId: caller.merchantId,
        toUserId: recipient.recipientId,
        participants: [caller.merchantId, recipient.recipientId],
        amount: input.amount,
        currency: input.currency,
        status: "completed",
        description: input.reference ? `${merchantName} — ${input.reference}` : `From ${merchantName}`,
        journalEntryId,
        apiTransferId: transferRef.id,
        createdAt: now,
        completedAt: now,
      };
      tx.set(db.collection("transactions").doc(transactionId), row);

      const transfer: ApiTransfer = {
        ...base,
        recipientId: recipient.recipientId,
        journalEntryId,
        transactionId,
      };
      tx.create(transferRef, transfer);
      tx.set(dayRef, { usdCents: day.usdCents + usdCents, count: day.count + 1 });
      tx.create(idemRef, record);
      return { transfer };
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      throw conflict("insufficient_balance", "Your Zapp balance is too low for this transfer");
    }
    if (err instanceof FrozenAccountError) {
      throw conflict("account_frozen", "Your account or the recipient's is frozen. Contact Zapp support.");
    }
    if (err instanceof WalletNotFoundError) {
      throw conflict("wallet_missing", "A wallet for this transfer is missing. Contact Zapp support.");
    }
    throw err;
  }

  if ("replayOf" in outcome) {
    const snap = await db.collection(API_TRANSFERS_COLLECTION).doc(outcome.replayOf).get();
    return { id: snap.id, transfer: snap.data() as ApiTransfer, replayed: true };
  }

  const { transfer } = outcome;
  if (transfer.recipientId) {
    notifyUser(
      transfer.recipientId,
      "payment_received",
      {
        key: "transfer.received",
        params: { amount: pushAmount(transfer.amount, transfer.currency), sender: caller.merchant.fullName || "Zapp" },
      },
      {
        type: "payment_received",
        amount: transfer.amount.toString(),
        currency: transfer.currency,
        senderId: caller.merchantId,
      }
    ).catch((err) => console.error("Failed to notify transfer recipient:", err));
  }
  return { id: transferRef.id, transfer, replayed: false };
}

async function replayTransfer(record: ApiIdempotencyRecord, requestHash: string): Promise<CreateTransferResult> {
  if (record.requestHash !== requestHash) throw idempotencyMismatch();
  const snap = await admin.firestore().collection(API_TRANSFERS_COLLECTION).doc(record.objectId).get();
  if (!snap.exists) {
    throw new ApiError(500, "api_error", "internal_error", "Transfer for this Idempotency-Key is missing");
  }
  return { id: snap.id, transfer: snap.data() as ApiTransfer, replayed: true };
}

export async function getOwnTransfer(caller: ApiCaller, transferId: string): Promise<ApiTransfer> {
  await requireTransferPartner(caller);
  if (!TRANSFER_ID_PATTERN.test(transferId)) throw notFound("transfer");
  const snap = await admin.firestore().collection(API_TRANSFERS_COLLECTION).doc(transferId).get();
  const t = snap.data() as ApiTransfer | undefined;
  if (!t || t.merchantId !== caller.merchantId || t.livemode !== caller.livemode) throw notFound("transfer");
  return t;
}

/** "Mahamed Farah" → "Ma***** Fa***". Enough to confirm a number, not to learn a name. */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const chars = Array.from(word);
      const keep = chars.length <= 2 ? 1 : 2;
      return chars.slice(0, keep).join("") + "*".repeat(Math.max(1, chars.length - keep));
    })
    .join(" ");
}

/**
 * Can this number receive a transfer? For a partner checking a number when
 * its worker saves it, so a payout never goes to a typo. Rate-limited per key.
 */
export async function lookupAccount(caller: ApiCaller, query: Record<string, unknown>) {
  const partner = await requireTransferPartner(caller);
  const phone = parsePhone(query.phone, "phone", partner.testPhoneNumbers ?? []);
  await enforceApiRateLimit(`lookup:${caller.keyId}`, LOOKUPS_PER_MINUTE);

  let found = false;
  let nameHint: string | null = null;
  if (!caller.livemode) {
    found = !phone.endsWith(TEST_NOT_FOUND_SUFFIX);
    nameHint = found ? "Te** Ac*****" : null;
  } else {
    const r = await resolveRecipient(phone, caller.merchantId).catch(() => ({ failure: "recipient_not_found" as const }));
    if (!("failure" in r)) {
      found = true;
      nameHint = r.user.fullName ? maskName(r.user.fullName) : null;
    }
  }
  return {
    object: "account_lookup",
    phone,
    // Only "can be paid" is answered. A closed or frozen account reads as not found.
    found,
    name_hint: nameHint,
    livemode: caller.livemode,
  };
}
