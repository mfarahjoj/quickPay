/**
 * Applying one shop event to the read model, exactly once.
 *
 * One Firestore transaction reads every doc the event touches, folds the
 * event in (fold.ts) and writes them back together with a marker
 * `merchantStats/{store}/applied/{txId}`. A redelivered trigger, the
 * nightly catch-up and the backfill all come through here, so whichever
 * gets to a row first counts it and the others find the marker.
 *
 * Markers are kept for good (no TTL): a marker that expired would let a
 * later backfill count the row twice. They are a few bytes per sale.
 *
 * Unique customers are counted with a first-visit marker per day and per
 * month (`days/{d}/visitors/{customer}`), so they stay exact whatever order
 * events arrive in.
 */

import * as admin from "firebase-admin";
import { foldCustomer, foldPeriod, foldRecent, foldRoot, shortName } from "./fold";
import { localParts } from "./time";
import {
  CustomerStats,
  PeriodStats,
  RecentFeed,
  RecentItem,
  StoreEvent,
  StoreStatsRoot,
} from "./types";

export const STATS_COLLECTION = "merchantStats";

export function statsRefs(db: FirebaseFirestore.Firestore, storeUid: string) {
  const root = db.collection(STATS_COLLECTION).doc(storeUid);
  return {
    root,
    day: (day: string) => root.collection("days").doc(day),
    month: (month: string) => root.collection("months").doc(month),
    dayVisitor: (day: string, customerUid: string) =>
      root.collection("days").doc(day).collection("visitors").doc(customerUid),
    monthVisitor: (month: string, customerUid: string) =>
      root.collection("months").doc(month).collection("visitors").doc(customerUid),
    customer: (customerUid: string) => root.collection("customers").doc(customerUid),
    recent: root.collection("live").doc("recent"),
    applied: (txId: string) => root.collection("applied").doc(txId),
  };
}

/**
 * A sale from a scanned customer code was the counter tablet's when its
 * payment request says so. Read outside the transaction: requests don't
 * change source once raised.
 */
export async function resolveChannel(db: FirebaseFirestore.Firestore, ev: StoreEvent): Promise<StoreEvent> {
  if (ev.type !== "sale" || ev.channel !== "scan" || !ev.requestId) return ev;
  try {
    const req = await db.collection("paymentRequests").doc(ev.requestId).get();
    if (req.exists && req.data()?.source === "counter_display") return { ...ev, channel: "display_scan" };
  } catch (err) {
    console.warn(`merchantStats: could not read paymentRequests/${ev.requestId}:`, err);
  }
  return ev;
}

/** The customer's name as the live feed shows it ("Amina H."). */
async function customerShortName(db: FirebaseFirestore.Firestore, ev: StoreEvent): Promise<string | undefined> {
  if (ev.type !== "sale" && ev.type !== "refund") return undefined;
  try {
    const snap = await db.collection("users").doc(ev.customerUid).get();
    return shortName(snap.data()?.fullName);
  } catch {
    return undefined;
  }
}

export type ApplyResult = "applied" | "already_applied";

export async function applyStoreEvent(
  rawEvent: StoreEvent,
  opts: { db?: FirebaseFirestore.Firestore; nowMs?: number } = {}
): Promise<ApplyResult> {
  const db = opts.db ?? admin.firestore();
  const ev = await resolveChannel(db, rawEvent);
  const name = await customerShortName(db, ev);
  const refs = statsRefs(db, ev.storeUid);
  const { day, month } = localParts(ev.atMs);
  const isCustomerEvent = ev.type === "sale" || ev.type === "refund";
  const customerUid = isCustomerEvent ? ev.customerUid : "";

  return db.runTransaction(async (tx) => {
    const nowMs = opts.nowMs ?? Date.now();
    const [marker, rootSnap, daySnap, monthSnap, recentSnap] = await Promise.all([
      tx.get(refs.applied(ev.txId)),
      tx.get(refs.root),
      tx.get(refs.day(day)),
      tx.get(refs.month(month)),
      tx.get(refs.recent),
    ]);
    if (marker.exists) return "already_applied" as const;

    let customerSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    let dayVisitorSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    let monthVisitorSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    if (isCustomerEvent) {
      [customerSnap, dayVisitorSnap, monthVisitorSnap] = await Promise.all([
        tx.get(refs.customer(customerUid)),
        tx.get(refs.dayVisitor(day, customerUid)),
        tx.get(refs.monthVisitor(month, customerUid)),
      ]);
    }

    const isSale = ev.type === "sale";
    const newCustomer = isSale && !customerSnap?.exists;
    const firstToday = isSale && !dayVisitorSnap?.exists;
    const firstThisMonth = isSale && !monthVisitorSnap?.exists;

    const nextDay = foldPeriod(
      daySnap.data() as PeriodStats | undefined,
      ev.storeUid,
      day,
      ev,
      isSale ? { firstInPeriod: firstToday, newCustomer } : null,
      nowMs
    );
    const nextMonth = foldPeriod(
      monthSnap.data() as PeriodStats | undefined,
      ev.storeUid,
      month,
      ev,
      isSale ? { firstInPeriod: firstThisMonth, newCustomer } : null,
      nowMs
    );

    tx.set(refs.day(day), nextDay);
    tx.set(refs.month(month), nextMonth);
    tx.set(refs.root, foldRoot(rootSnap.data() as StoreStatsRoot | undefined, ev, nowMs));

    if (ev.type === "sale" || ev.type === "refund") {
      // A refund of a sale from before the read model existed has no
      // customer record to adjust; don't invent one with no visits.
      if (ev.type === "sale" || customerSnap?.exists) {
        tx.set(
          refs.customer(customerUid),
          foldCustomer(customerSnap?.data() as CustomerStats | undefined, ev, firstToday, nowMs)
        );
      }
      if (firstToday) tx.set(refs.dayVisitor(day, customerUid), { atMs: ev.atMs });
      if (firstThisMonth) tx.set(refs.monthVisitor(month, customerUid), { atMs: ev.atMs });

      const item: RecentItem = {
        txId: ev.txId,
        type: ev.type,
        currency: ev.currency,
        gross: ev.gross,
        net: ev.net,
        atMs: ev.atMs,
        ...(ev.type === "sale" ? { channel: ev.channel } : {}),
        ...(name ? { customerName: name } : {}),
      };
      tx.set(refs.recent, foldRecent(recentSnap.data() as RecentFeed | undefined, item, nowMs));
    }

    tx.set(refs.applied(ev.txId), { type: ev.type, atMs: ev.atMs, appliedAtMs: nowMs });
    return "applied" as const;
  });
}
