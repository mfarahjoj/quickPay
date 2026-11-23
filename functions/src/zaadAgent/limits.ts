/**
 * Who may top up by Zaad through an agent, and how much (D5, D13, D15, D25).
 *
 * Shared by the remote request (customer.ts) and the in-person start
 * (inPerson.ts): the risk comes from the Zaad payment, not from where the
 * agent is standing, so both apply exactly the same rules.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertAccountActive } from "../utils/accountStatus";
import { enforcePerTransactionLimit } from "../utils/limits";
import { isPrivilegedRole } from "../utils/roles";
import { formatAmount } from "../utils/money";
import { Rates } from "../config/rates";
import { User } from "../types";
import { activeStrikes } from "./core";
import {
  ACTIVE_STATUSES,
  ZAAD_AGENT_CUSTOMERS,
  ZAAD_AGENT_TOPUPS,
  ZaadAgentCustomerDoc,
  ZaadAgentTopup,
  ZaadTopupStatus,
} from "./types";

const DAY_MS = 24 * 3600 * 1000;
/** Requests that never got as far as an agent's float don't count towards the daily amount. */
const NOT_COUNTED: readonly ZaadTopupStatus[] = ["no_agent", "cancelled", "expired", "released"];

/** The switch in the console (config/rates), off by default. */
export function assertZaadAgentOpen(rates: Rates): void {
  if (rates.zaadAgentTopups !== "on") {
    throw new https.HttpsError("unavailable", "Zaad top-ups through agents aren't open yet", { reason: "off" });
  }
}

/** A Zaad top-up's amount, in US cents, inside the console's limits. */
export function assertZaadAmount(amount: unknown, rates: Rates): asserts amount is number {
  const min = rates.zaadAgentTopupMinCents;
  const max = rates.zaadAgentTopupMaxCents;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < min || amount > max) {
    throw new https.HttpsError(
      "invalid-argument",
      `Top up between ${formatAmount(min, "USD")} and ${formatAmount(max, "USD")}`,
      { reason: "amount_out_of_range", minCents: min, maxCents: max }
    );
  }
}

/**
 * The customer may be topped up [amount] by Zaad now: an active customer
 * account with a phone number, inside the KYC cap, not blocked or struck out,
 * and inside today's count and amount. Reads only; the one-at-a-time lock is
 * taken in the caller's transaction (claimZaadSlot).
 */
export async function checkZaadCustomer(
  uid: string,
  amount: number,
  rates: Rates,
  nowMs: number
): Promise<{ user: User; customerRef: FirebaseFirestore.DocumentReference }> {
  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw new https.HttpsError("not-found", "User not found");
  const user = userSnap.data() as User;
  assertAccountActive(user);
  // Agents and merchants hold float or takings; a cash-in to them moves
  // value between businesses (agentGuards.ts).
  if (isPrivilegedRole(user.accountType)) {
    throw new https.HttpsError("permission-denied", "Zaad top-ups through agents are for customer accounts");
  }
  // D5: the payment must come from the customer's own number, which sign-up
  // verified by SMS code.
  if (!user.phoneNumber) {
    throw new https.HttpsError("failed-precondition", "The customer's account has no phone number");
  }
  await enforcePerTransactionLimit(amount, user, "USD");

  const customerRef = db.collection(ZAAD_AGENT_CUSTOMERS).doc(uid);
  const customer = (await customerRef.get()).data() as ZaadAgentCustomerDoc | undefined;
  if (
    customer?.blocked ||
    activeStrikes(customer?.strikes, rates.zaadAgentStrikeWindowDays, nowMs) >= rates.zaadAgentCustomerStrikes
  ) {
    throw new https.HttpsError(
      "permission-denied",
      "Zaad top-ups through agents are paused on this account. Contact Zapp Pay support.",
      { reason: "blocked" }
    );
  }

  const recent = await db
    .collection(ZAAD_AGENT_TOPUPS)
    .where("customerId", "==", uid)
    .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(nowMs - DAY_MS))
    .limit(100)
    .get();
  if (recent.size >= rates.zaadAgentDailyCount) {
    throw new https.HttpsError("resource-exhausted", "You've asked for as many Zaad top-ups as you can today", {
      reason: "daily_count",
    });
  }
  const todayCents = recent.docs
    .map((d) => d.data() as ZaadAgentTopup)
    .filter((r) => !NOT_COUNTED.includes(r.status))
    .reduce((sum, r) => sum + r.amount, 0);
  if (todayCents + amount > rates.zaadAgentDailyMaxCents) {
    throw new https.HttpsError(
      "resource-exhausted",
      `You can top up ${formatAmount(Math.max(0, rates.zaadAgentDailyMaxCents - todayCents), "USD")} more by Zaad today`,
      { reason: "daily_amount" }
    );
  }
  return { user, customerRef };
}

/**
 * Inside a transaction, before any write: refuse if the customer already has
 * a Zaad top-up in progress. The caller then sets `activeRequestId` to the
 * new request in the same transaction.
 */
export async function assertNoActiveZaad(
  tx: FirebaseFirestore.Transaction,
  customerRef: FirebaseFirestore.DocumentReference
): Promise<void> {
  const lock = (await tx.get(customerRef)).data() as ZaadAgentCustomerDoc | undefined;
  if (!lock?.activeRequestId) return;
  const open = (await tx.get(admin.firestore().collection(ZAAD_AGENT_TOPUPS).doc(lock.activeRequestId))).data() as
    | ZaadAgentTopup
    | undefined;
  if (open && ACTIVE_STATUSES.includes(open.status)) {
    throw new https.HttpsError("already-exists", "There's already a Zaad top-up in progress for this customer", {
      reason: "in_progress",
      requestId: lock.activeRequestId,
    });
  }
}
