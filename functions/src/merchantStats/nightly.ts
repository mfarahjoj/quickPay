/**
 * The nightly pass over the merchant read model (03:30 Hargeisa, after the
 * ledger check):
 *
 * 1. Catch up: every row completed yesterday goes through applyStoreEvent.
 *    Rows the trigger already counted find their marker and are skipped;
 *    rows it missed (a failed or dropped trigger) are counted now.
 * 2. Backfill: while `config/merchantStats.backfill.active` is set, walk the
 *    history oldest first through the same applyStoreEvent, a few minutes per
 *    run, saving a cursor. Ops starts it with scripts/backfill-merchant-stats.js
 *    and can run the job again at once from Cloud Scheduler rather than wait.
 * 3. Check: rebuild yesterday's day doc for every shop from the rows alone
 *    and compare. A difference is a bug in this module; it is logged and
 *    recorded in `merchantStatsRuns/{day}`, never patched over, so the day,
 *    month and customer docs stay consistent with each other.
 */

import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Transaction } from "../types";
import { applyStoreEvent, resolveChannel, statsRefs } from "./apply";
import { classifyTransaction } from "./classify";
import { foldPeriod } from "./fold";
import { addDays, dayBounds, localParts } from "./time";
import { CustomerStats, PeriodStats, STATS_CURRENCIES, StoreEvent } from "./types";

const PAGE = 300;
const BACKFILL_BUDGET_MS = 6 * 60 * 1000;
export const STATS_CONFIG_DOC = "config/merchantStats";
export const RUNS_COLLECTION = "merchantStatsRuns";

type Db = FirebaseFirestore.Firestore;
const ts = (ms: number) => admin.firestore.Timestamp.fromMillis(ms);

/** Every completed row whose completion falls in [startMs, endMs), as shop events. */
export async function eventsCompletedBetween(db: Db, startMs: number, endMs: number): Promise<{ scanned: number; events: StoreEvent[] }> {
  const events: StoreEvent[] = [];
  let scanned = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db
      .collection("transactions")
      .where("completedAt", ">=", ts(startMs))
      .where("completedAt", "<", ts(endMs))
      .orderBy("completedAt", "asc")
      .limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const doc of snap.docs) {
      scanned += 1;
      const ev = classifyTransaction(doc.id, doc.data() as Transaction);
      if (ev) events.push(ev);
    }
    if (snap.docs.length < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return { scanned, events };
}

/** Step 1. */
export async function catchUp(db: Db, events: StoreEvent[]): Promise<number> {
  let applied = 0;
  for (const ev of events) {
    try {
      if ((await applyStoreEvent(ev, { db })) === "applied") applied += 1;
    } catch (err) {
      console.error(`merchantStats catch-up: failed on ${ev.txId}:`, err);
    }
  }
  return applied;
}

/** Day docs for one local day, rebuilt from the events alone. Pure. */
export function rebuildDays(
  day: string,
  events: StoreEvent[],
  firstSeenDayOf: (storeUid: string, customerUid: string) => string | undefined
): Map<string, PeriodStats> {
  const out = new Map<string, PeriodStats>();
  const seen = new Set<string>();
  const sorted = [...events].filter((e) => localParts(e.atMs).day === day).sort((a, b) => a.atMs - b.atMs);
  for (const ev of sorted) {
    let visit = null;
    if (ev.type === "sale") {
      const key = `${ev.storeUid}/${ev.customerUid}`;
      const first = !seen.has(key);
      seen.add(key);
      visit = { firstInPeriod: first, newCustomer: first && firstSeenDayOf(ev.storeUid, ev.customerUid) === day };
    }
    out.set(ev.storeUid, foldPeriod(out.get(ev.storeUid), ev.storeUid, day, ev, visit, 0));
  }
  return out;
}

/** Where a stored day doc and the rebuilt one disagree, as readable paths. Pure. */
export function diffDay(stored: PeriodStats | undefined, rebuilt: PeriodStats): string[] {
  const diffs: string[] = [];
  const walk = (path: string, a: unknown, b: unknown) => {
    if (typeof b === "number" || typeof a === "number") {
      const x = typeof a === "number" ? a : 0;
      const y = typeof b === "number" ? b : 0;
      if (x !== y) diffs.push(`${path}: stored ${x}, rows ${y}`);
      return;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      const n = Math.max((a as unknown[] | undefined)?.length ?? 0, (b as unknown[] | undefined)?.length ?? 0);
      for (let i = 0; i < n; i++) walk(`${path}[${i}]`, (a as unknown[] | undefined)?.[i], (b as unknown[] | undefined)?.[i]);
      return;
    }
    if ((a && typeof a === "object") || (b && typeof b === "object")) {
      const keys = new Set([...Object.keys((a as object) ?? {}), ...Object.keys((b as object) ?? {})]);
      for (const k of keys) walk(path ? `${path}.${k}` : k, (a as Record<string, unknown>)?.[k], (b as Record<string, unknown>)?.[k]);
    }
  };
  for (const cur of STATS_CURRENCIES) walk(`currencies.${cur}`, stored?.currencies?.[cur], rebuilt.currencies?.[cur]);
  walk("customers.unique", stored?.customers?.unique, rebuilt.customers.unique);
  walk("customers.new", stored?.customers?.new, rebuilt.customers.new);
  return diffs;
}

/** Step 3. */
export async function checkDay(db: Db, day: string, events: StoreEvent[]): Promise<{ storesChecked: number; drifts: string[] }> {
  const resolved = await Promise.all(events.map((e) => resolveChannel(db, e)));
  const firstSeen = new Map<string, string | undefined>();
  for (const ev of resolved) {
    if (ev.type !== "sale") continue;
    const key = `${ev.storeUid}/${ev.customerUid}`;
    if (firstSeen.has(key)) continue;
    const snap = await statsRefs(db, ev.storeUid).customer(ev.customerUid).get();
    firstSeen.set(key, (snap.data() as CustomerStats | undefined)?.firstSeenDay);
  }
  const rebuilt = rebuildDays(day, resolved, (s, c) => firstSeen.get(`${s}/${c}`));
  const drifts: string[] = [];
  for (const [storeUid, doc] of rebuilt) {
    const stored = (await statsRefs(db, storeUid).day(day).get()).data() as PeriodStats | undefined;
    for (const d of diffDay(stored, doc)) drifts.push(`${storeUid} ${day} ${d}`);
  }
  return { storesChecked: rebuilt.size, drifts };
}

export interface BackfillState {
  active: boolean;
  cursorMs?: number;
  scanned?: number;
  applied?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
}

/** Step 2: one budgeted slice of the history, oldest first. */
export async function backfillStep(db: Db, budgetMs = BACKFILL_BUDGET_MS, clock: () => number = Date.now): Promise<BackfillState | null> {
  const cfgRef = db.doc(STATS_CONFIG_DOC);
  const state = ((await cfgRef.get()).data()?.backfill ?? null) as BackfillState | null;
  if (!state?.active) return null;

  const deadline = clock() + budgetMs;
  let cursorMs = state.cursorMs ?? 0;
  let scanned = state.scanned ?? 0;
  let applied = state.applied ?? 0;
  let done = false;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (clock() < deadline) {
    // Resume at the cursor's millisecond (>=): rows sharing it are replayed,
    // and their markers make that harmless.
    let q = db.collection("transactions").where("createdAt", ">=", ts(cursorMs)).orderBy("createdAt", "asc").limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const doc of snap.docs) {
      scanned += 1;
      const row = doc.data() as Transaction;
      const ev = classifyTransaction(doc.id, row);
      if (ev) {
        try {
          if ((await applyStoreEvent(ev, { db })) === "applied") applied += 1;
        } catch (err) {
          console.error(`merchantStats backfill: failed on ${doc.id}:`, err);
        }
      }
      const created = (row.createdAt as unknown as { toMillis?: () => number })?.toMillis?.();
      if (typeof created === "number") cursorMs = created;
    }
    if (snap.docs.length < PAGE) {
      done = true;
      break;
    }
    last = snap.docs[snap.docs.length - 1];
  }

  const next: BackfillState = {
    ...state,
    active: !done,
    cursorMs,
    scanned,
    applied,
    ...(done ? { finishedAtMs: clock() } : {}),
  };
  await cfgRef.set({ backfill: next }, { merge: true });
  console.log(`merchantStats backfill: ${done ? "finished" : "paused"} at ${new Date(cursorMs).toISOString()}, ${scanned} rows read, ${applied} applied`);
  return next;
}

export async function runMerchantStatsNightly(nowMs = Date.now(), db: Db = admin.firestore()) {
  const yesterday = addDays(localParts(nowMs).day, -1);
  const { startMs, endMs } = dayBounds(yesterday);
  const { scanned, events } = await eventsCompletedBetween(db, startMs, endMs);
  const caughtUp = await catchUp(db, events);

  let backfill: BackfillState | null = null;
  try {
    backfill = await backfillStep(db);
  } catch (err) {
    console.error("merchantStats backfill step failed:", err);
  }

  const { storesChecked, drifts } = await checkDay(db, yesterday, events);
  await db.collection(RUNS_COLLECTION).doc(yesterday).set({
    day: yesterday,
    rowsScanned: scanned,
    shopEvents: events.length,
    caughtUp,
    storesChecked,
    driftCount: drifts.length,
    drifts: drifts.slice(0, 100),
    ...(backfill ? { backfill } : {}),
    ranAtMs: Date.now(),
  });

  if (caughtUp > 0) {
    console.warn(`merchantStats: caught up ${caughtUp} row(s) the trigger missed on ${yesterday}`);
  }
  if (drifts.length > 0) {
    console.error(`MERCHANT STATS DRIFT on ${yesterday}: ${drifts.length} difference(s)`, JSON.stringify(drifts.slice(0, 20)));
  } else {
    console.log(`merchantStats ${yesterday}: ${events.length} shop events, ${storesChecked} shops, zero drift`);
  }
  return { day: yesterday, scanned, caughtUp, storesChecked, drifts, backfill };
}

/** Daily at 03:30 Hargeisa time, after ledgerInvariantCheck. */
export const merchantStatsNightly = onSchedule(
  { schedule: "30 3 * * *", timeZone: "Africa/Mogadishu", memory: "512MiB", timeoutSeconds: 540 },
  async () => {
    await runMerchantStatsNightly();
  }
);
