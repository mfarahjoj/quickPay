import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { ago, ledgerNeedsAttention, waitingTotal, type QueueKey, type Work } from "../work";

/**
 * The console's home: one card per queue this admin works, with how much is
 * waiting and for how long, each opening its desk in one click. Nothing is
 * decided here; the desks still own every action and its audit entry.
 */

const CARDS: Record<QueueKey, { title: string; icon: IconName; empty: string }> = {
  disputes: { title: "Disputes to decide", icon: "flag", empty: "No dispute is waiting on Zapp" },
  payouts: { title: "Payouts to send", icon: "send", empty: "Every payout has been sent" },
  float: { title: "Float to approve", icon: "banknote", empty: "No float request waiting" },
  zaad: { title: "Zaad payments on hold", icon: "inbox", empty: "Every Zaad payment was credited" },
  agentzaad: { title: "Agent Zaad top-ups", icon: "send", empty: "No agent top-up needs a decision" },
  roles: { title: "Role applications", icon: "briefcase", empty: "No application waiting" },
  kyc: { title: "Identity checks", icon: "idcard", empty: "No ID waiting for review" },
};

export interface ShortcutLink {
  tab: string;
  label: string;
  hint: string;
  icon: IconName;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function TodoDesk({
  work,
  keys,
  onOpen,
  shortcuts,
  showLedger,
}: {
  work: Work;
  keys: QueueKey[];
  onOpen: (tab: string) => void;
  shortcuts: ShortcutLink[];
  showLedger: boolean;
}) {
  // Re-render each minute so "5 min ago" stays true between loads.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60 * 1000);
    return () => window.clearInterval(t);
  }, []);

  const total = waitingTotal(work);
  const failed = keys.filter((k) => work.queues[k]?.count === null).length;
  const firstLoad = work.loadedAt == null;
  const ledgerAlert = showLedger && ledgerNeedsAttention(work.ledger);

  // Overdue or unreadable first, then work waiting, then the clear ones;
  // each group keeps the sidebar's order (sort is stable).
  const rank = (k: QueueKey) => {
    const q = work.queues[k];
    if (q?.count === null || q?.urgent) return 0;
    return (q?.count ?? 0) > 0 ? 1 : 2;
  };
  const ordered = [...keys].sort((a, b) => rank(a) - rank(b));

  const summary = firstLoad
    ? "Checking every queue…"
    : total === 0 && failed === 0 && !ledgerAlert
      ? "You're all caught up. Nothing is waiting on you."
      : total === 0 && failed === 0
        ? "No queue is waiting, but the ledger needs a look."
        : `${total} ${total === 1 ? "thing is" : "things are"} waiting on you${
            failed > 0 ? `, and ${failed} ${failed === 1 ? "queue" : "queues"} couldn't be read` : ""
          }.`;

  return (
    <div className="stack-lg">
      <section className="todo-hero" aria-live="polite">
        <div>
          <div className="todo-hello">{greeting()}</div>
          <div className="todo-summary">{summary}</div>
        </div>
        <div className="spacer" />
        <button
          className="ghost"
          onClick={() => work.refresh()}
          disabled={work.loading}
          title={work.loadedAt ? `Updated ${ago(work.loadedAt)}` : undefined}
        >
          <Icon name="refresh" size={16} />
          {work.loading ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      {showLedger && work.ledger && (
        <button
          className={`todo-ledger ${ledgerAlert ? "bad" : "ok"}`}
          onClick={() => onOpen("ledger")}
        >
          <span className="todo-ledger-dot" aria-hidden="true" />
          <span className="todo-ledger-text">
            {work.ledger.spendIndex?.ok === false ? (
              <><strong>Payments are blocked.</strong> The spend index is down. Open the ledger.</>
            ) : ledgerAlert ? (
              <>
                <strong>Ledger needs a look.</strong> {work.ledger.openAlertCount} open alert
                {work.ledger.openAlertCount === 1 ? "" : "s"}
                {work.ledger.lastRun?.ok === false ? " and the last nightly check failed" : ""}.
              </>
            ) : (
              <><strong>Ledger balanced.</strong> Every wallet matched the journal in the last check.</>
            )}
          </span>
          <Icon name="chevron" size={16} />
        </button>
      )}

      <div className="todo-grid">
        {ordered.map((key) => {
          const card = CARDS[key];
          const q = work.queues[key];
          const count = q?.count;
          const busy = count === undefined;
          const unknown = count === null;
          const clear = count === 0;
          const tone = unknown ? "bad" : q?.urgent ? "bad" : clear ? "clear" : busy ? "busy" : "work";
          return (
            <button key={key} className="todo-card" data-tone={tone} onClick={() => onOpen(key)}>
              <span className="todo-icon" aria-hidden="true">
                <Icon name={clear ? "check" : card.icon} size={20} />
              </span>
              <span className="todo-body">
                <span className="todo-title">{card.title}</span>
                <span className="todo-sub">
                  {busy
                    ? "Loading…"
                    : unknown
                      ? "Couldn't load. Open the desk to retry."
                      : clear
                        ? card.empty
                        : q?.detail ?? "Waiting for a decision"}
                </span>
              </span>
              <span className="todo-count" aria-label={busy || unknown ? undefined : `${count} waiting`}>
                {busy ? "" : unknown ? "!" : count}
              </span>
            </button>
          );
        })}
      </div>

      {shortcuts.length > 0 && (
        <section>
          <h2 className="todo-section">Everything else</h2>
          <div className="todo-links">
            {shortcuts.map((s) => (
              <button key={s.tab} className="todo-link" onClick={() => onOpen(s.tab)}>
                <Icon name={s.icon} size={18} />
                <span>
                  <span className="todo-link-title">{s.label}</span>
                  <span className="todo-link-hint">{s.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
