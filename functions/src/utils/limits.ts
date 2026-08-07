/**
 * Enforcing per-transaction, daily and monthly limits.
 *
 * `getAccountLimits` has always shown customers a daily and monthly cap;
 * nothing ever enforced them, so the only real ceiling was per-transaction.
 * Verifying a customer's KYC now raises their per-transaction cap, which made
 * that gap wider rather than narrower.
 *
 * Runs alongside `enforceVelocity` (which caps transaction *count*) — the two
 * answer different questions: how often, and how much.
 */

import * as admin from "firebase-admin";
import { AggregateField } from "firebase-admin/firestore";
import { https } from "firebase-functions/v2";
import { limitsFor, type TierLimits } from "../config/limits";
import { centsToDollars } from "./validation";

/**
 * Transaction types that count as value leaving an account.
 *
 * Deliberately not `fromUserId` alone: a mobile-money top-up and a
 * mobile-money cash-out both write `fromUserId === toUserId === userId`, so
 * counting by sender would make topping up eat your own spending limit.
 *
 * `topup` and `referral` are inbound. `refund` is excluded because a refund
 * can only reverse a payment the merchant already received — it is bounded by
 * prior inbound value, and blocking refunds to protect a spend cap would hurt
 * customers rather than help them.
 */
export const SPEND_TX_TYPES = ["payment", "withdrawal"] as const;

/**
 * Somaliland is UTC+3 and Cloud Functions run in UTC. Without this, "today"
 * would roll over at 3am local and a late-evening transaction would count
 * against the following day.
 */
const LOCAL_UTC_OFFSET_HOURS = 3;

function localNow(now: Date): Date {
  return new Date(now.getTime() + LOCAL_UTC_OFFSET_HOURS * 3600 * 1000);
}

/** Start of the local calendar day, as a UTC instant. */
export function startOfLocalDay(now: Date = new Date()): Date {
  const local = localNow(now);
  const midnightLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  );
  return new Date(midnightLocal - LOCAL_UTC_OFFSET_HOURS * 3600 * 1000);
}

/** Start of the local calendar month, as a UTC instant. */
export function startOfLocalMonth(now: Date = new Date()): Date {
  const local = localNow(now);
  const firstLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return new Date(firstLocal - LOCAL_UTC_OFFSET_HOURS * 3600 * 1000);
}

/**
 * Total value this account has sent since `since`, in cents.
 *
 * Uses a Firestore sum aggregation so the cost does not grow with the number
 * of transactions — the previous implementation in `getAccountLimits` read
 * every matching document.
 */
export async function sumSpendSince(userId: string, since: Date): Promise<number> {
  const snap = await admin
    .firestore()
    .collection("transactions")
    .where("fromUserId", "==", userId)
    .where("type", "in", SPEND_TX_TYPES as unknown as string[])
    .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(since))
    .aggregate({ total: AggregateField.sum("amount") })
    .get();

  const total = snap.data().total;
  return typeof total === "number" ? total : 0;
}

export interface SpendUsage {
  dailyUsed: number;
  monthlyUsed: number;
}

/** Current day and month spend, in cents. */
export async function getSpendUsage(
  userId: string,
  now: Date = new Date()
): Promise<SpendUsage> {
  const [dailyUsed, monthlyUsed] = await Promise.all([
    sumSpendSince(userId, startOfLocalDay(now)),
    sumSpendSince(userId, startOfLocalMonth(now)),
  ]);
  return { dailyUsed, monthlyUsed };
}

function exceeded(kind: "Daily" | "Monthly", limit: number, used: number): never {
  const remaining = Math.max(0, limit - used);
  throw new https.HttpsError(
    "resource-exhausted",
    `${kind} limit reached. You can send $${centsToDollars(remaining).toFixed(2)} ` +
      `more this ${kind === "Daily" ? "day" : "month"} ` +
      `(limit $${centsToDollars(limit).toFixed(2)}).`,
    { limit, used, remaining, kind: kind.toLowerCase() }
  );
}

export interface Account {
  kycStatus?: unknown;
  accountType?: unknown;
}

/**
 * Assert a single amount fits the account's per-transaction cap.
 *
 * Split out because it also applies to inbound flows (an agent cash-in is
 * capped per transaction but is not spending), and because payroll checks one
 * cap per employee while checking the aggregate once for the whole run.
 */
export async function enforcePerTransactionLimit(
  amountCents: number,
  account: Account
): Promise<void> {
  const { limits } = await limitsFor(account.kycStatus, account.accountType);
  if (amountCents > limits.perTransaction) {
    throw new https.HttpsError(
      "permission-denied",
      `This exceeds the $${centsToDollars(limits.perTransaction).toFixed(2)} ` +
        "limit for a single transaction."
    );
  }
}

/**
 * Assert `amountCents` more spending still fits today's and this month's caps.
 *
 * Note the check is not inside the posting transaction — a Firestore
 * aggregation cannot be. Two payments racing each other could therefore both
 * pass a near-boundary check, the same window `enforceVelocity` has. That is
 * acceptable for a spend cap (worst case is a small overshoot on one
 * transaction) and is not the control preventing overdrafts: the ledger's
 * non-negative balance rule does that, inside the transaction.
 */
export async function enforceAggregateLimits(
  userId: string,
  amountCents: number,
  account: Account,
  now: Date = new Date()
): Promise<void> {
  const { limits } = await limitsFor(account.kycStatus, account.accountType);
  const { dailyUsed, monthlyUsed } = await getSpendUsage(userId, now);

  if (dailyUsed + amountCents > limits.daily) {
    exceeded("Daily", limits.daily, dailyUsed);
  }
  if (monthlyUsed + amountCents > limits.monthly) {
    exceeded("Monthly", limits.monthly, monthlyUsed);
  }
}

/** The usual case: one outbound transaction, checked against every limit. */
export async function enforceTransactionLimits(
  userId: string,
  amountCents: number,
  account: Account,
  now: Date = new Date()
): Promise<void> {
  await enforcePerTransactionLimit(amountCents, account);
  await enforceAggregateLimits(userId, amountCents, account, now);
}

/** Shape used by `getAccountLimits` so advertised and enforced cannot drift. */
export function describeLimits(
  limits: TierLimits,
  usage: SpendUsage
): Record<string, number> {
  return {
    dailyLimit: centsToDollars(limits.daily),
    monthlyLimit: centsToDollars(limits.monthly),
    perTransactionLimit: centsToDollars(limits.perTransaction),
    dailyUsed: centsToDollars(usage.dailyUsed),
    monthlyUsed: centsToDollars(usage.monthlyUsed),
    dailyRemaining: centsToDollars(Math.max(0, limits.daily - usage.dailyUsed)),
    monthlyRemaining: centsToDollars(
      Math.max(0, limits.monthly - usage.monthlyUsed)
    ),
  };
}
