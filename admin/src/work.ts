import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatFloat, type FloatCurrency, type LedgerHealth } from "./api";

/**
 * What is waiting on an admin, across every queue they can act on, so the
 * console can open on a to-do list and the sidebar can carry counts.
 *
 * Read-only: each count comes from the same `admin*` list callable the desk
 * itself uses, so a number here always matches what the desk shows.
 */

export type QueueKey = "roles" | "kyc" | "float" | "payouts" | "disputes" | "zaad" | "agentzaad";

export interface QueueState {
  /** Null when the list could not be read: never shown as "nothing to do". */
  count: number | null;
  /** Epoch ms of the oldest item waiting, when the rows carry a date. */
  oldestAt: number | null;
  /** One short line under the count. */
  detail?: string;
  /** Something is past its deadline. */
  urgent?: boolean;
  error?: string;
}

export interface Work {
  queues: Partial<Record<QueueKey, QueueState>>;
  ledger: LedgerHealth | null;
  loadedAt: number | null;
  loading: boolean;
  /** Reloads unless a load finished less than `maxAgeMs` ago. */
  refresh: (maxAgeMs?: number) => void;
}

type Ts = { _seconds?: number; seconds?: number } | null | undefined;

function tsMs(ts: Ts): number | null {
  const s = ts?._seconds ?? ts?.seconds;
  return typeof s === "number" ? s * 1000 : null;
}

function oldest(values: Array<number | null>): number | null {
  const real = values.filter((v): v is number => typeof v === "number");
  return real.length ? Math.min(...real) : null;
}

/** "4 min", "3 h", "2 days". */
export function span(ms: number): string {
  const min = Math.max(1, Math.round(Math.abs(ms) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function ago(at: number | null, now = Date.now()): string | null {
  return at == null ? null : `${span(now - at)} ago`;
}

/** "$1,240.00 · 30,000 SLSH" for a mixed list. */
function totals(rows: Array<{ amountCents: number; currency?: FloatCurrency | string }>): string {
  const sum: Record<FloatCurrency, number> = { USD: 0, SLS: 0 };
  for (const r of rows) sum[r.currency === "SLS" ? "SLS" : "USD"] += r.amountCents;
  return (["USD", "SLS"] as const)
    .filter((c) => sum[c] > 0)
    .map((c) => formatFloat(sum[c], c))
    .join(" · ");
}

function join(...parts: Array<string | null | undefined | false>): string | undefined {
  const kept = parts.filter(Boolean) as string[];
  return kept.length ? kept.join(" · ") : undefined;
}

type Loader = () => Promise<Omit<QueueState, "error">>;

function loaders(adminUid: string, now: number): Record<QueueKey, Loader> {
  return {
    roles: async () => {
      const rows = await api.listRoleRequests("pending");
      const names = rows
        .map((r) => r.businessName || r.applicantName)
        .filter(Boolean)
        .slice(0, 2) as string[];
      return {
        count: rows.length,
        oldestAt: null,
        detail: names.length ? names.join(", ") + (rows.length > names.length ? "…" : "") : undefined,
      };
    },
    kyc: async () => {
      const rows = await api.listKycQueue("submitted");
      const at = oldest(rows.map((r) => tsMs(r.submittedAt)));
      return { count: rows.length, oldestAt: at, detail: join(at != null && `oldest sent ${ago(at, now)}`) };
    },
    float: async () => {
      const rows = await api.listFloatIssuances("pending");
      // A request this admin raised needs someone else's approval.
      const mine = rows.filter((r) => r.requiresSecondApprover && r.requestedBy === adminUid).length;
      const at = oldest(rows.map((r) => tsMs(r.createdAt)));
      return {
        count: rows.length,
        oldestAt: at,
        detail: join(
          rows.length > 0 && totals(rows),
          mine > 0 && `${mine} of yours need another admin`
        ),
      };
    },
    payouts: async () => {
      const payouts = await api.listPayouts("requested");
      const at = oldest(payouts.map((r) => tsMs(r.createdAt)));
      return {
        count: payouts.length,
        oldestAt: at,
        detail: join(payouts.length > 0 && totals(payouts), at != null && `oldest ${ago(at, now)}`),
      };
    },
    disputes: async () => {
      const disputes = await api.listDisputes("under_review");
      const deadlines = disputes.map((d) => d.resolveBy).filter((v): v is number => typeof v === "number");
      const overdue = deadlines.filter((d) => d < now).length;
      const next = deadlines.filter((d) => d >= now).sort((a, b) => a - b)[0];
      return {
        count: disputes.length,
        oldestAt: oldest(disputes.map((d) => d.createdAt)),
        urgent: overdue > 0,
        detail: join(
          overdue > 0 && `${overdue} past the deadline`,
          next != null && `next due in ${span(next - now)}`
        ),
      };
    },
    zaad: async () => {
      const rows = await api.listHeldMobileMoney();
      const at = oldest(rows.map((r) => r.receivedAt));
      return {
        count: rows.length,
        oldestAt: at,
        detail: join(rows.length > 0 && totals(rows), at != null && `oldest ${ago(at, now)}`),
      };
    },
    agentzaad: async () => {
      const { topups } = await api.listZaadTopups("attention");
      const at = oldest(topups.map((r) => r.disputedAt ?? r.reversal?.reportedAt ?? r.createdAt));
      return {
        count: topups.length,
        oldestAt: at,
        detail: join(topups.length > 0 && totals(topups), at != null && `oldest ${ago(at, now)}`),
      };
    },
  };
}

/** Which queues each admin role works. */
export function queuesFor(canReviewRoles: boolean, canRunFloatDesk: boolean): QueueKey[] {
  // Money owed to people first, then applications: the sidebar's order.
  const keys: QueueKey[] = [];
  if (canRunFloatDesk) keys.push("disputes", "payouts", "float", "zaad", "agentzaad");
  if (canReviewRoles) keys.push("roles", "kyc");
  return keys;
}

const POLL_MS = 60 * 1000;

export function useWork(adminUid: string, keys: QueueKey[], withLedger: boolean): Work {
  const [queues, setQueues] = useState<Work["queues"]>({});
  const [ledger, setLedger] = useState<LedgerHealth | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const loadedAtRef = useRef<number | null>(null);
  const keyList = keys.join(",");

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const now = Date.now();
    const all = loaders(adminUid, now);
    const wanted = keyList ? (keyList.split(",") as QueueKey[]) : [];
    try {
      const [results, health] = await Promise.all([
        Promise.allSettled(wanted.map((k) => all[k]())),
        withLedger ? api.ledgerHealth().catch(() => null) : Promise.resolve(null),
      ]);
      const next: Work["queues"] = {};
      results.forEach((r, i) => {
        next[wanted[i]] =
          r.status === "fulfilled"
            ? r.value
            : {
                count: null,
                oldestAt: null,
                error: r.reason instanceof Error ? r.reason.message : "Could not load",
              };
      });
      setQueues(next);
      setLedger(health);
      loadedAtRef.current = Date.now();
      setLoadedAt(loadedAtRef.current);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [adminUid, keyList, withLedger]);

  const refresh = useCallback(
    (maxAgeMs = 0) => {
      const at = loadedAtRef.current;
      if (maxAgeMs > 0 && at != null && Date.now() - at < maxAgeMs) return;
      void load();
    },
    [load]
  );

  useEffect(() => {
    void load();
    // Keep the counts fresh while the console is in front; catch up on return.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onFocus = () => refresh(15 * 1000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, refresh]);

  return { queues, ledger, loadedAt, loading, refresh };
}

/** Everything waiting, for the page title and the summary line. */
export function waitingTotal(work: Work): number {
  return Object.values(work.queues).reduce((n, q) => n + (q?.count ?? 0), 0);
}

/** The ledger needs someone: spending is blocked, a check failed, or alerts are open. */
export function ledgerNeedsAttention(h: LedgerHealth | null): boolean {
  if (!h) return false;
  return h.spendIndex?.ok === false || h.openAlertCount > 0 || h.lastRun?.ok === false;
}
