/**
 * Ledger desk — the console's window into reconciliation
 * (LEDGER_ARCHITECTURE.md §3.5).
 *
 * The invariant check (ledger/invariantCheck.ts) records every run in
 * `ledger_checkpoints` and, when something is wrong, an alert in
 * `ledger_alerts` under the same id. These callables let ops read that
 * history, open a run's drift, trace a customer wallet back through its
 * transactions, acknowledge an alert, and re-run the check once a correction
 * has been posted.
 *
 * Nothing here edits a balance. Drift is fixed by posting an `adjustment`
 * journal entry; this desk only shows where it is.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse } from "../types";
import { requireAdmin, requireReason } from "./guard";
import { stageAuditEntry, writeAuditEntry } from "./audit";
import { isUserAccount, isValidAccount, userIdOf } from "../ledger/accounts";
import { JOURNAL_COLLECTION, LEDGER_BALANCES_COLLECTION } from "../ledger/post";
import { JournalEntryDoc } from "../ledger/types";
import { runInvariantCheck } from "../ledger/invariantCheck";

const CHECKPOINTS = "ledger_checkpoints";
const ALERTS = "ledger_alerts";

/** Runs shown in the history list. */
const HISTORY_LIMIT = 30;
/** Transactions loaded when tracing one wallet. */
const TRACE_LIMIT = 100;

/**
 * The invariant job stores NaN for "no value" (a missing wallet, a corrupt
 * entry). Firestore keeps NaN; JSON does not, so it goes out as null.
 */
export function finiteOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Net effect of one journal entry on one account: credit − debit, in cents. */
export function walletEffect(entry: Pick<JournalEntryDoc, "lines">, account: string): number {
  return entry.lines
    .filter((line) => line.account === account)
    .reduce((sum, line) => sum + line.credit - line.debit, 0);
}

/**
 * How a transaction relates to the journal:
 * - `posted`: its journal entry exists.
 * - `no-entry-id`: it never recorded one.
 * - `entry-missing`: it names an entry that does not exist.
 */
export type LedgerLink = "posted" | "no-entry-id" | "entry-missing";

export interface TraceRow {
  id: string;
  type: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  description: string | null;
  createdAt: unknown;
  direction: "in" | "out" | null;
  journalEntryId: string | null;
  link: LedgerLink;
  entryType: string | null;
  /** What the journal entry did to this wallet; null when there is no entry. */
  walletEffect: number | null;
}

export function traceTransaction(
  id: string,
  tx: FirebaseFirestore.DocumentData,
  entries: Map<string, Pick<JournalEntryDoc, "lines" | "type">>,
  account: string
): TraceRow {
  const uid = userIdOf(account);
  const entryId =
    typeof tx.journalEntryId === "string" && tx.journalEntryId ? tx.journalEntryId : null;
  const entry = entryId ? entries.get(entryId) : undefined;

  return {
    id,
    type: typeof tx.type === "string" ? tx.type : null,
    status: typeof tx.status === "string" ? tx.status : null,
    amount: finiteOrNull(tx.amount),
    currency: typeof tx.currency === "string" ? tx.currency : null,
    description: typeof tx.description === "string" ? tx.description : null,
    createdAt: tx.createdAt ?? null,
    direction: tx.toUserId === uid ? "in" : tx.fromUserId === uid ? "out" : null,
    journalEntryId: entryId,
    link: !entryId ? "no-entry-id" : entry ? "posted" : "entry-missing",
    entryType: entry?.type ?? null,
    walletEffect: entry ? walletEffect(entry, account) : null,
  };
}

const SETTLED = new Set(["completed", "success"]);

/**
 * Completed transactions without a journal entry moved value outside the
 * ledger — the classic source of "wallet does not match journal" drift.
 * Pending or failed ones are expected to have no entry.
 */
export function summarizeTrace(rows: TraceRow[]): {
  completed: number;
  completedUnposted: number;
  completedUnpostedAmount: number;
} {
  const completed = rows.filter((r) => r.status !== null && SETTLED.has(r.status));
  const unposted = completed.filter((r) => r.link !== "posted");
  return {
    completed: completed.length,
    completedUnposted: unposted.length,
    completedUnpostedAmount: unposted.reduce((sum, r) => sum + (r.amount ?? 0), 0),
  };
}

function requireAlertId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.includes("/")) {
    throw new https.HttpsError("invalid-argument", "alertId is required");
  }
  return value.trim();
}

interface StoredDrift {
  account?: unknown;
  expected?: unknown;
  actual?: unknown;
  detail?: unknown;
}

/** An activity-monitor finding as stored on an alert (ledger/activityMonitor.ts). */
interface StoredFinding {
  kind?: unknown;
  account?: unknown;
  counterparty?: unknown;
  amount?: unknown;
  count?: unknown;
  entryIds?: unknown[];
  detail?: unknown;
}

/** Run history and alert state for the ledger desk. */
export const adminGetLedgerOverview = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<void>): Promise<ApiResponse<Record<string, unknown>>> => {
    requireAdmin(request, "ops");

    const db = admin.firestore();
    const [checkpoints, alerts, open] = await Promise.all([
      db.collection(CHECKPOINTS).orderBy("ranAt", "desc").limit(HISTORY_LIMIT).get(),
      db.collection(ALERTS).orderBy("ranAt", "desc").limit(HISTORY_LIMIT).get(),
      // Counted rather than listed: the banner's list stops at 5, and "5" when
      // there are 40 understates how long drift has gone unanswered.
      db.collection(ALERTS).where("acknowledged", "==", false).count().get(),
    ]);

    return {
      success: true,
      data: {
        runs: checkpoints.docs.map((doc) => {
          const run = doc.data();
          return {
            id: doc.id,
            ranAt: run.ranAt ?? null,
            entryCount: run.entryCount ?? 0,
            accountCount: run.accountCount ?? 0,
            driftCount: run.driftCount ?? 0,
            // Checkpoints from before the spend-index probe have no field.
            spendIndexOk: run.spendIndexOk !== false,
            ok: run.ok === true,
            // Runs from before the activity monitor have no field.
            activityFindingCount: run.activityFindingCount ?? 0,
            trigger: run.trigger ?? "schedule",
            triggeredBy: run.triggeredBy ?? null,
          };
        }),
        alerts: alerts.docs.map((doc) => {
          const alert = doc.data();
          return {
            id: doc.id,
            ranAt: alert.ranAt ?? null,
            driftCount: alert.driftCount ?? 0,
            spendIndexOk: alert.spendIndexOk !== false,
            activityFindingCount: alert.activityFindingCount ?? 0,
            acknowledged: alert.acknowledged === true,
            acknowledgedByEmail: alert.acknowledgedByEmail ?? null,
            acknowledgedAt: alert.acknowledgedAt ?? null,
          };
        }),
        openAlertCount: open.data().count,
      },
    };
  }
);

/**
 * One alert's drift list, with the customer behind each wallet account and
 * what the balance reads now (it may have moved since the check ran).
 */
export const adminGetLedgerAlert = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ alertId: string }>
  ): Promise<ApiResponse<Record<string, unknown>>> => {
    const actor = requireAdmin(request, "ops");
    const alertId = requireAlertId(request.data?.alertId);

    const db = admin.firestore();
    const snap = await db.collection(ALERTS).doc(alertId).get();
    if (!snap.exists) {
      throw new https.HttpsError("not-found", "Alert not found");
    }

    const alert = snap.data()!;
    const stored: StoredDrift[] = Array.isArray(alert.drifts) ? alert.drifts : [];
    const accountOf = (d: StoredDrift) => (typeof d.account === "string" ? d.account : "");
    const findings: StoredFinding[] = Array.isArray(alert.activity) ? alert.activity : [];
    const findingAccounts = findings.flatMap((f) =>
      [f.account, f.counterparty].filter((a): a is string => typeof a === "string")
    );

    const uids = [
      ...new Set(
        [...stored.map(accountOf), ...findingAccounts].filter(isUserAccount).map(userIdOf)
      ),
    ];
    const others = [
      ...new Set(
        stored.map(accountOf).filter((a) => isValidAccount(a) && !isUserAccount(a))
      ),
    ];

    // getAll() needs at least one ref.
    const [users, wallets, balances] = await Promise.all([
      uids.length ? db.getAll(...uids.map((u) => db.collection("users").doc(u))) : [],
      uids.length ? db.getAll(...uids.map((u) => db.collection("wallets").doc(u))) : [],
      others.length
        ? db.getAll(...others.map((a) => db.collection(LEDGER_BALANCES_COLLECTION).doc(a)))
        : [],
    ]);

    const byId = (snaps: FirebaseFirestore.DocumentSnapshot[]) =>
      new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()!]));
    const userMap = byId(users);
    const walletMap = byId(wallets);
    const balanceMap = byId(balances);

    // The customer behind a wallet account; null for platform accounts.
    const who = (account: unknown) => {
      if (typeof account !== "string" || !isUserAccount(account)) return null;
      const uid = userIdOf(account);
      const profile = userMap.get(uid);
      return {
        userId: uid,
        fullName: profile?.fullName ?? null,
        phoneNumber: profile?.phoneNumber ?? null,
        accountType: profile?.accountType ?? null,
      };
    };

    const drifts = stored.map((d) => {
      const account = accountOf(d);
      const expected = finiteOrNull(d.expected);
      const actual = finiteOrNull(d.actual);
      let currentBalance: number | null = null;
      let user: Record<string, unknown> | null = null;

      if (isUserAccount(account)) {
        user = who(account);
        const wallet = walletMap.get(userIdOf(account));
        currentBalance = wallet ? finiteOrNull(wallet.balance ?? 0) : null;
      } else if (balanceMap.has(account)) {
        currentBalance = finiteOrNull(balanceMap.get(account)!.balance ?? 0);
      }

      return {
        account,
        detail: typeof d.detail === "string" ? d.detail : "",
        expected,
        actual,
        difference: expected !== null && actual !== null ? actual - expected : null,
        currentBalance,
        user,
      };
    });

    // Names and balances of several customers at once: worth a trail, like
    // opening a single customer's record is.
    writeAuditEntry({
      actor,
      action: "ledger.alert.view",
      target: { type: "ledger_alert", id: alertId },
      reason: "Ledger drift review",
    }).catch((err) => console.error("Failed to write view audit:", err));

    const activity = findings.map((f) => ({
      kind: typeof f.kind === "string" ? f.kind : "",
      account: typeof f.account === "string" ? f.account : "",
      counterparty: typeof f.counterparty === "string" ? f.counterparty : null,
      amount: finiteOrNull(f.amount),
      count: finiteOrNull(f.count) ?? 0,
      entryIds: Array.isArray(f.entryIds) ? f.entryIds.filter((id) => typeof id === "string") : [],
      detail: typeof f.detail === "string" ? f.detail : "",
      user: who(f.account),
      counterpartyUser: who(f.counterparty),
    }));

    return {
      success: true,
      data: {
        id: alertId,
        ranAt: alert.ranAt ?? null,
        trigger: alert.trigger ?? "schedule",
        driftCount: alert.driftCount ?? drifts.length,
        // The job stores at most 100 drifts per alert.
        shownCount: drifts.length,
        drifts,
        spendIndexOk: alert.spendIndexOk !== false,
        spendIndexError: alert.spendIndexError ?? null,
        activity,
        activityFindingCount: alert.activityFindingCount ?? activity.length,
        activityEntryCount: alert.activityEntryCount ?? null,
        activityTruncated: alert.activityTruncated === true,
        activityError: alert.activityError ?? null,
        acknowledged: alert.acknowledged === true,
        acknowledgedByEmail: alert.acknowledgedByEmail ?? null,
        acknowledgedAt: alert.acknowledgedAt ?? null,
        acknowledgeReason: alert.acknowledgeReason ?? null,
      },
    };
  }
);

/**
 * Trace a customer wallet: its recent transactions and whether each one made
 * it into the journal, so drift can be pinned to the movements behind it.
 *
 * Journal entries cannot be queried by account (lines are an array of
 * objects), so this works from the indexed transactions side. Entries with no
 * transaction record — adjustments, float, payouts — will not appear here.
 */
export const adminTraceLedgerAccount = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ account: string }>
  ): Promise<ApiResponse<Record<string, unknown>>> => {
    const actor = requireAdmin(request, "ops");

    const account = request.data?.account;
    if (typeof account !== "string" || !isValidAccount(account) || !isUserAccount(account)) {
      throw new https.HttpsError(
        "invalid-argument",
        "Only customer wallets (user:…) can be traced"
      );
    }
    const uid = userIdOf(account);

    const db = admin.firestore();
    const [userSnap, walletSnap, txSnap] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("wallets").doc(uid).get(),
      db
        .collection("transactions")
        .where("participants", "array-contains", uid)
        .orderBy("createdAt", "desc")
        .limit(TRACE_LIMIT)
        .get(),
    ]);

    const entryIds = [
      ...new Set(
        txSnap.docs
          .map((d) => d.data().journalEntryId)
          .filter((id): id is string => typeof id === "string" && id.length > 0 && !id.includes("/"))
      ),
    ];
    const entrySnaps = entryIds.length
      ? await db.getAll(...entryIds.map((id) => db.collection(JOURNAL_COLLECTION).doc(id)))
      : [];
    const entries = new Map(
      entrySnaps
        .filter((s) => s.exists)
        .map((s) => [s.id, s.data() as JournalEntryDoc])
    );

    const transactions = txSnap.docs.map((d) => traceTransaction(d.id, d.data(), entries, account));

    writeAuditEntry({
      actor,
      action: "ledger.trace",
      target: { type: "wallet", id: uid },
      reason: "Ledger drift investigation",
    }).catch((err) => console.error("Failed to write trace audit:", err));

    const profile = userSnap.exists ? userSnap.data()! : null;
    const wallet = walletSnap.exists ? walletSnap.data()! : null;

    return {
      success: true,
      data: {
        account,
        user: profile
          ? {
              userId: uid,
              fullName: profile.fullName ?? null,
              phoneNumber: profile.phoneNumber ?? null,
              accountType: profile.accountType ?? null,
            }
          : null,
        wallet: wallet
          ? {
              balance: finiteOrNull(wallet.balance ?? 0),
              currency: wallet.currency ?? null,
              frozen: wallet.frozen === true,
              updatedAt: wallet.updatedAt ?? null,
            }
          : null,
        transactions,
        truncated: txSnap.size === TRACE_LIMIT,
        summary: summarizeTrace(transactions),
      },
    };
  }
);

/**
 * Mark an alert as seen and owned. It silences the banner for that run only;
 * the drift stays until a correction is posted and a check comes back clean.
 */
export const adminAcknowledgeLedgerAlert = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ alertId: string; reason: string }>
  ): Promise<ApiResponse<{ auditId: string }>> => {
    const actor = requireAdmin(request, "ops");
    const reason = requireReason(request.data?.reason);
    const alertId = requireAlertId(request.data?.alertId);

    const db = admin.firestore();
    const ref = db.collection(ALERTS).doc(alertId);

    const auditId = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new https.HttpsError("not-found", "Alert not found");
      }
      if (snap.data()!.acknowledged === true) {
        throw new https.HttpsError("failed-precondition", "This alert is already acknowledged");
      }

      tx.update(ref, {
        acknowledged: true,
        acknowledgedAt: admin.firestore.Timestamp.now(),
        acknowledgedBy: actor.uid,
        acknowledgedByEmail: actor.email,
        acknowledgeReason: reason,
      });

      return stageAuditEntry(tx, {
        actor,
        action: "ledger.alert.acknowledge",
        target: { type: "ledger_alert", id: alertId },
        reason,
        before: { acknowledged: false },
        after: { acknowledged: true },
      });
    });

    return { success: true, message: "Alert acknowledged", data: { auditId } };
  }
);

/**
 * Run the invariant check now — the way to confirm a correction worked
 * without waiting for 03:00. It is the same full replay the schedule runs,
 * recorded the same way, marked as manual.
 */
export const adminRunLedgerCheck = https.onCall(
  { enforceAppCheck: true, timeoutSeconds: 540, memory: "512MiB" },
  async (
    request: https.CallableRequest<{ reason: string }>
  ): Promise<ApiResponse<Record<string, unknown>>> => {
    const actor = requireAdmin(request, "ops");
    const reason = requireReason(request.data?.reason);

    const result = await runInvariantCheck({
      trigger: "manual",
      triggeredBy: actor.email || actor.uid,
    });

    await writeAuditEntry({
      actor,
      action: "ledger.check.run",
      target: { type: "ledger_check", id: result.runId },
      reason,
      after: {
        driftCount: result.drifts.length,
        entryCount: result.entryCount,
        spendIndexOk: result.spendIndexOk,
        activityFindingCount: result.activityFindingCount,
      },
    });

    return {
      success: true,
      data: {
        runId: result.runId,
        driftCount: result.drifts.length,
        entryCount: result.entryCount,
        spendIndexOk: result.spendIndexOk,
        activityFindingCount: result.activityFindingCount,
      },
    };
  }
);
