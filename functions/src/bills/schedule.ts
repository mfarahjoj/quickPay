/**
 * Every hour: send repeating bills that are due to go out, then auto-pay the
 * bills that have fallen due for customers who turned auto-pay on.
 *
 * Auto-pay runs the same guards as a customer's own payment (both accounts
 * active, the pause after a PIN reset, the customer's limits) except the PIN,
 * which the customer gave when they turned auto-pay on. Each bill is tried at
 * most once a day and BILL_LIMITS.autopayMaxTries times; after that it waits
 * for the customer, who is told each time a try fails.
 */

import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { https } from "firebase-functions/v2";
import { isAccountActive } from "../utils/accountStatus";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
import {
  BILLS,
  BILL_AUTOPAY,
  BILL_LIMITS,
  BILL_SERIES,
  Bill,
  BillAutopay,
  BillSeries,
  autopayId,
} from "./types";
import { addDays, nextDue, startOfDayMs } from "./dates";
import { notifyBillIssued } from "./issue";
import { AutopayNotAllowed, guardBillPayment, settleBill } from "./settle";
import { notifyBillPaid } from "./customer";

const BATCH = 200;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Auto-pay only looks this far back: tries run out well within it. */
const AUTOPAY_WINDOW_DAYS = 7;
/** Less than a day, so an hourly run that starts a little early still retries daily. */
const RETRY_GAP_MS = 20 * HOUR_MS;

export interface BillsRunResult {
  issued: number;
  paid: number;
  failed: number;
}

/** Send the next bill of each repeating bill whose time has come. */
async function issueSeriesBills(now: FirebaseFirestore.Timestamp): Promise<number> {
  const db = admin.firestore();
  const due = await db
    .collection(BILL_SERIES)
    .where("active", "==", true)
    .where("nextIssueAt", "<=", now)
    .limit(BATCH)
    .get();

  let issued = 0;
  for (const doc of due.docs) {
    try {
      const s = doc.data() as BillSeries;
      const [merchant, customer] = await Promise.all([
        db.collection("users").doc(s.merchantId).get(),
        db.collection("users").doc(s.customerId).get(),
      ]);
      // A frozen shop or customer gets no bill this time; the series moves on.
      const send = isAccountActive(merchant.data()) && isAccountActive(customer.data());

      const billId = `${doc.id}_${s.nextDueDate}`;
      let created: Bill | undefined;
      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(doc.ref)).data() as BillSeries | undefined;
        if (!fresh?.active || fresh.nextDueDate !== s.nextDueDate) return; // another run got here
        const billRef = db.collection(BILLS).doc(billId);
        const exists = (await tx.get(billRef)).exists;

        if (send && !exists) {
          created = {
            merchantId: fresh.merchantId,
            merchantName: fresh.merchantName,
            customerId: fresh.customerId,
            customerName: fresh.customerName,
            amount: fresh.amount,
            currency: fresh.currency,
            description: fresh.description,
            ...(fresh.reference ? { reference: fresh.reference } : {}),
            dueDate: fresh.nextDueDate,
            dueAt: admin.firestore.Timestamp.fromMillis(startOfDayMs(fresh.nextDueDate)),
            status: "open",
            seriesId: doc.id,
            createdAt: now,
          };
          tx.create(billRef, created);
        }

        const following = nextDue(fresh.nextDueDate, fresh.interval, fresh.anchorDay);
        tx.update(doc.ref, {
          nextDueDate: following,
          nextIssueAt: admin.firestore.Timestamp.fromMillis(
            startOfDayMs(addDays(following, -BILL_LIMITS.issueDaysBefore))
          ),
        });
      });
      if (created) {
        issued++;
        await notifyBillIssued(billId, created);
      }
    } catch (err) {
      // One bad series must not stop the rest; the next run retries it.
      console.error(`Could not send the next bill of series ${doc.id}:`, err);
    }
  }
  return issued;
}

function failureReason(err: unknown): string {
  if (err instanceof https.HttpsError) return err.message;
  if (err instanceof Error && err.message === "Insufficient balance") return "Insufficient balance";
  return "Payment failed";
}

/** Auto-pay open bills that have fallen due. */
async function autopayDueBills(now: FirebaseFirestore.Timestamp): Promise<{ paid: number; failed: number }> {
  const db = admin.firestore();
  const due = await db
    .collection(BILLS)
    .where("status", "==", "open")
    .where("dueAt", "<=", now)
    .where("dueAt", ">=", admin.firestore.Timestamp.fromMillis(now.toMillis() - AUTOPAY_WINDOW_DAYS * DAY_MS))
    .limit(BATCH)
    .get();

  let paid = 0;
  let failed = 0;
  for (const doc of due.docs) {
    const bill = doc.data() as Bill;
    if ((bill.autopayTries ?? 0) >= BILL_LIMITS.autopayMaxTries) continue;
    const lastTried = bill.autopayLastTriedAt?.toMillis() ?? 0;
    if (now.toMillis() - lastTried < RETRY_GAP_MS) continue;

    const setting = (
      await db.collection(BILL_AUTOPAY).doc(autopayId(bill.customerId, bill.merchantId)).get()
    ).data() as BillAutopay | undefined;
    if (!setting?.active || setting.currency !== bill.currency || bill.amount > setting.maxAmount) {
      continue; // Not covered: the customer pays it themselves.
    }

    try {
      await guardBillPayment(bill.customerId, bill);
      const settled = await settleBill(doc.id, bill.customerId, "autopay");
      if (settled.alreadyPaid) continue;
      paid++;
      notifyBillPaid(settled, bill.customerId, bill.description);
      notifyUser(
        bill.customerId,
        "bill",
        {
          key: "bill.autopaid",
          params: {
            merchant: bill.merchantName,
            amount: pushAmount(bill.amount, bill.currency),
            description: bill.description,
          },
        },
        { type: "bill_paid", billId: doc.id, transactionId: settled.transactionId }
      ).catch((err) => console.error("Failed to notify customer of auto-pay:", err));
    } catch (err) {
      if (err instanceof AutopayNotAllowed) continue; // turned off mid-run
      failed++;
      const reason = failureReason(err);
      console.warn(`Auto-pay of bill ${doc.id} failed: ${reason}`);
      try {
        await doc.ref.update({
          autopayTries: admin.firestore.FieldValue.increment(1),
          autopayLastTriedAt: now,
          autopayLastError: reason,
        });
      } catch (writeErr) {
        console.error(`Could not record the failed auto-pay of bill ${doc.id}:`, writeErr);
      }
      notifyUser(
        bill.customerId,
        "bill",
        {
          key: "bill.autopay_failed",
          params: { merchant: bill.merchantName, amount: pushAmount(bill.amount, bill.currency) },
        },
        { type: "bill", billId: doc.id }
      ).catch((e) => console.error("Failed to notify customer of failed auto-pay:", e));
    }
  }
  return { paid, failed };
}

export async function runBillsNow(now = admin.firestore.Timestamp.now()): Promise<BillsRunResult> {
  const issued = await issueSeriesBills(now);
  const { paid, failed } = await autopayDueBills(now);
  if (issued || paid || failed) {
    console.log(`Bills: sent ${issued}, auto-paid ${paid}, auto-pay failed ${failed}`);
  }
  return { issued, paid, failed };
}

export const billsHourly = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Africa/Mogadishu" },
  async () => {
    await runBillsNow();
  }
);
