/**
 * Scheduled ledger invariant check — LEDGER_ARCHITECTURE.md §3.5.
 *
 * Replays the entire journal, recomputes every account balance from first
 * principles, and compares against the cached projections (`wallets` and
 * `ledger_balances`). Any mismatch is drift: it means money moved outside
 * `postJournalEntry()` or a projection write was lost. Results are recorded
 * in `ledger_checkpoints`; drift additionally writes a `ledger_alerts` doc
 * and logs at ERROR severity so Cloud Monitoring can page on it.
 *
 * Each run also runs the activity monitor (activityMonitor.ts) over the last
 * 24h. Drift says the books disagree with themselves; the monitor looks for
 * balanced entries that should not exist, which drift can never show.
 */

import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { JournalEntryDoc } from "./types";
import { isUserAccount, userIdOf } from "./accounts";
import { JOURNAL_COLLECTION, LEDGER_BALANCES_COLLECTION } from "./post";
import { probeSpendIndex } from "../utils/limits";
import { ActivityReport, runActivityMonitor } from "./activityMonitor";

const BATCH_SIZE = 500;

/** Legacy pre-ledger platform wallet doc; superseded by ledger_balances. */
const LEGACY_PLATFORM_WALLET = "platform";

interface Drift {
  account: string;
  expected: number;
  actual: number;
  detail: string;
}

interface ReplayResult {
  entryCount: number;
  /** account -> journal-derived balance (credit − debit), in cents. */
  balances: Map<string, number>;
  /** Entries whose lines do not sum to zero (should be impossible). */
  corruptEntries: string[];
}

async function replayJournal(db: FirebaseFirestore.Firestore): Promise<ReplayResult> {
  const balances = new Map<string, number>();
  const corruptEntries: string[] = [];
  let entryCount = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let query = db
      .collection(JOURNAL_COLLECTION)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(BATCH_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const entry = doc.data() as JournalEntryDoc;
      entryCount++;
      let net = 0;
      for (const line of entry.lines) {
        net += line.credit - line.debit;
        balances.set(
          line.account,
          (balances.get(line.account) ?? 0) + line.credit - line.debit
        );
      }
      if (net !== 0) corruptEntries.push(doc.id);
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < BATCH_SIZE) break;
  }

  return { entryCount, balances, corruptEntries };
}

/** Who started a run: the nightly schedule, or an admin from the console. */
export interface RunMeta {
  trigger: "schedule" | "manual";
  triggeredBy?: string;
}

/** Full check, callable from the schedule, the admin ledger desk, or tests/scripts. */
export async function runInvariantCheck(
  meta: RunMeta = { trigger: "schedule" }
): Promise<{
  drifts: Drift[];
  entryCount: number;
  spendIndexOk: boolean;
  activityFindingCount: number;
  runId: string;
}> {
  const db = admin.firestore();
  const { entryCount, balances, corruptEntries } = await replayJournal(db);
  const drifts: Drift[] = [];

  for (const entryId of corruptEntries) {
    drifts.push({
      account: "(entry)",
      expected: 0,
      actual: NaN,
      detail: `Journal entry ${entryId} does not sum to zero`,
    });
  }

  // The journal must itself net to zero across all accounts.
  let globalNet = 0;
  balances.forEach((v) => (globalNet += v));
  if (globalNet !== 0) {
    drifts.push({
      account: "(global)",
      expected: 0,
      actual: globalNet,
      detail: "Journal does not net to zero across all accounts",
    });
  }

  // Journal-derived user balances vs wallet projections.
  const walletsSnap = await db.collection("wallets").get();
  const walletBalances = new Map<string, number>();
  walletsSnap.forEach((doc) => {
    if (doc.id !== LEGACY_PLATFORM_WALLET) {
      walletBalances.set(doc.id, doc.data().balance ?? 0);
    }
  });

  balances.forEach((expected, account) => {
    if (!isUserAccount(account)) return;
    const uid = userIdOf(account);
    const actual = walletBalances.get(uid);
    if (actual === undefined) {
      drifts.push({
        account,
        expected,
        actual: NaN,
        detail: "Journal references this account but wallets doc is missing",
      });
    } else if (actual !== expected) {
      drifts.push({
        account,
        expected,
        actual,
        detail: "Wallet balance does not match journal",
      });
    }
    walletBalances.delete(uid);
  });

  // Wallets the journal knows nothing about must be empty.
  walletBalances.forEach((actual, uid) => {
    if (actual !== 0) {
      drifts.push({
        account: `user:${uid}`,
        expected: 0,
        actual,
        detail: "Wallet has a balance with no journal entries explaining it",
      });
    }
  });

  // Journal-derived non-user balances vs ledger_balances projections.
  const ledgerBalSnap = await db.collection(LEDGER_BALANCES_COLLECTION).get();
  const projected = new Map<string, number>();
  ledgerBalSnap.forEach((doc) => projected.set(doc.id, doc.data().balance ?? 0));

  balances.forEach((expected, account) => {
    if (isUserAccount(account)) return;
    const actual = projected.get(account) ?? 0;
    if (actual !== expected) {
      drifts.push({
        account,
        expected,
        actual,
        detail: "ledger_balances projection does not match journal",
      });
    }
    projected.delete(account);
  });

  projected.forEach((actual, account) => {
    if (actual !== 0) {
      drifts.push({
        account,
        expected: 0,
        actual,
        detail: "ledger_balances doc has a balance with no journal entries",
      });
    }
  });

  // Drift is about money that already moved. This is about money that cannot
  // move at all: the spend-limit query fails closed, so an index it cannot use
  // blocks every outbound flow at once. Checking it here means the daily job
  // pages ops, rather than a customer being the one to notice.
  const spendIndex = await probeSpendIndex();

  // A monitor failure must not cost us the reconciliation result above, so
  // it is caught and recorded on the alert instead of thrown.
  let activity: ActivityReport = { findings: [], entryCount: 0, truncated: false };
  let activityError: string | undefined;
  try {
    activity = await runActivityMonitor();
  } catch (err) {
    activityError = (err as Error)?.message ?? String(err);
  }
  const findings = activity.findings;

  // Record the run.
  const now = admin.firestore.Timestamp.now();
  const runId = now.toDate().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const trigger = {
    trigger: meta.trigger,
    ...(meta.triggeredBy ? { triggeredBy: meta.triggeredBy } : {}),
  };
  await db.collection("ledger_checkpoints").doc(runId).set({
    ranAt: now,
    entryCount,
    accountCount: balances.size,
    driftCount: drifts.length,
    spendIndexOk: spendIndex.ok,
    ok: drifts.length === 0 && spendIndex.ok,
    // Kept apart from `ok`: findings are leads for review, not broken books.
    activityFindingCount: findings.length,
    activityOk: !activityError,
    ...trigger,
  });

  if (drifts.length > 0 || !spendIndex.ok || findings.length > 0 || activityError) {
    await db.collection("ledger_alerts").doc(runId).set({
      ...trigger,
      ranAt: now,
      drifts: drifts.slice(0, 100),
      driftCount: drifts.length,
      spendIndexOk: spendIndex.ok,
      ...(spendIndex.error ? { spendIndexError: spendIndex.error } : {}),
      activity: findings.slice(0, 100),
      activityFindingCount: findings.length,
      activityEntryCount: activity.entryCount,
      activityTruncated: activity.truncated,
      ...(activityError ? { activityError } : {}),
      acknowledged: false,
    });
  }

  if (findings.length > 0) {
    console.error(
      `SUSPICIOUS LEDGER ACTIVITY: ${findings.length} finding(s) in the last 24h ` +
        `(${activity.entryCount} entries)`,
      JSON.stringify(findings.slice(0, 20))
    );
  }

  if (activityError) {
    console.error("Activity monitor failed; reconciliation still recorded:", activityError);
  }

  if (drifts.length > 0) {
    console.error(
      `LEDGER DRIFT DETECTED: ${drifts.length} mismatch(es) across ${entryCount} entries`,
      JSON.stringify(drifts.slice(0, 20))
    );
  }

  if (!spendIndex.ok) {
    console.error(
      "SPEND LIMIT QUERY UNSERVABLE: every outbound flow (cash-out, QR payment, " +
        "sendP2P, approvePaymentRequest, remittance, payroll) is failing closed. " +
        "Check the transactions fromUserId/type/createdAt/amount composite index.",
      spendIndex.error
    );
  }

  if (drifts.length === 0 && spendIndex.ok) {
    console.log(
      `Ledger invariant check OK: ${entryCount} entries, ${balances.size} accounts, zero drift`
    );
  }

  return {
    drifts,
    entryCount,
    spendIndexOk: spendIndex.ok,
    activityFindingCount: findings.length,
    runId,
  };
}

/** Daily at 03:00 Africa/Mogadishu (EAT — Hargeisa's timezone). */
export const ledgerInvariantCheck = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Africa/Mogadishu", memory: "512MiB" },
  async () => {
    await runInvariantCheck();
  }
);
