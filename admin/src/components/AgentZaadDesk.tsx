import { useCallback, useEffect, useState } from "react";
import { api, type UserSummary, type ZaadAgentRow, type ZaadTopupRow, type ZaadTopupStatus } from "../api";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { EmptyState, Loading } from "./ui";

function money(cents: number | null | undefined) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

function when(ms: number | null) {
  return ms ? new Date(ms).toLocaleString() : "—";
}

function ago(ms: number | null) {
  if (!ms) return "never";
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
}

const STATUS: Record<ZaadTopupStatus, { label: string; tone: "ok" | "warn" | "bad" | "" }> = {
  offered: { label: "Finding an agent", tone: "" },
  no_agent: { label: "No agent free", tone: "warn" },
  accepted: { label: "Waiting for the customer", tone: "" },
  customer_sent: { label: "Waiting for the agent", tone: "warn" },
  declined: { label: "Agent says not received", tone: "warn" },
  disputed: { label: "Disputed", tone: "bad" },
  completed: { label: "Credited", tone: "ok" },
  released: { label: "Float returned", tone: "" },
  expired: { label: "Not sent in time", tone: "" },
  cancelled: { label: "Cancelled", tone: "" },
};

const ANSWERS: Record<string, string> = {
  received: "Received",
  not_received: "Not received",
  different_amount: "A different amount",
};

function StatusBadge({ status }: { status: ZaadTopupStatus }) {
  const s = STATUS[status];
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
}

/**
 * Zaad top-ups through agents (functions/src/zaadAgent/).
 *
 * The customer pays an online agent's Zaad and the agent's float credits
 * their wallet. While a request is open the agent's float sits in
 * platform:zaad_agent_hold, so ops can always settle a dispute from there.
 * This desk: decisions waiting on ops, requests in progress, the agents and
 * their receiving numbers (checked in person), and unblocking a customer.
 * Prices, limits and the on/off switch are on the Pricing & rules page.
 */
export function AgentZaadDesk() {
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ heldCents: number; reversalLossCents: number } | null>(null);
  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}
      {summary && (
        <div className="panel">
          <div className="row">
            <div className="stat">
              <span className="stat-label">Agent float held for open top-ups</span>
              <span className="stat-value">{money(summary.heldCents)}</span>
            </div>
            <div className="spacer" />
            <div className="stat">
              <span className="stat-label">What reversals have cost Zapp</span>
              <span className="stat-value">{money(summary.reversalLossCents)}</span>
            </div>
          </div>
        </div>
      )}
      <DecisionsPanel onNotice={setNotice} onSummary={setSummary} />
      <RequestsPanel />
      <AgentsPanel onNotice={setNotice} />
      <UnblockPanel onNotice={setNotice} />
    </div>
  );
}

// -------------------------------------------------------------- decisions

function Timeline({ row }: { row: ZaadTopupRow }) {
  return (
    <dl className="kv">
      <dt>Customer</dt>
      <dd>
        {row.customerName} · {row.customerPhone ?? row.customerId}
      </dd>
      <dt>Agent</dt>
      <dd>
        {row.agentName ?? "—"} · receives on {row.agentReceiveNumber ?? "—"}
      </dd>
      <dt>Should pay from</dt>
      <dd>{row.allowedSenders.join(" or ") || "—"}</dd>
      <dt>Customer's Zaad ID</dt>
      <dd>{row.customerZaadTxnId ?? "none given"}</dd>
      <dt>Asked</dt>
      <dd>{when(row.createdAt)}</dd>
      <dt>Agent accepted</dt>
      <dd>{when(row.acceptedAt)}</dd>
      <dt>Customer said sent</dt>
      <dd>{when(row.customerSentAt)}</dd>
      <dt>Agent answered</dt>
      <dd>
        {row.agentAnswer ? `${ANSWERS[row.agentAnswer]}, ${when(row.agentAnsweredAt)}` : "didn't answer"}
      </dd>
      {row.disputedAt && (
        <>
          <dt>Disputed</dt>
          <dd>
            {when(row.disputedAt)} ·{" "}
            {row.disputedBy === "timeout" ? "the agent didn't answer in time" : "by the customer"}
            {row.disputeReason ? `: "${row.disputeReason}"` : ""}
          </dd>
        </>
      )}
      {row.reversal && (
        <>
          <dt>Reversal reported</dt>
          <dd>
            {when(row.reversal.reportedAt)}: "{row.reversal.note}"
            {row.reversal.agentZaadTxnId ? ` · reversal ID ${row.reversal.agentZaadTxnId}` : ""}
          </dd>
        </>
      )}
    </dl>
  );
}

type Decision =
  | { row: ZaadTopupRow; kind: "customer" | "agent" }
  | { row: ZaadTopupRow; kind: "repay" | "reject" };

function DecisionsPanel({
  onNotice,
  onSummary,
}: {
  onNotice: (s: string) => void;
  onSummary: (s: { heldCents: number; reversalLossCents: number }) => void;
}) {
  const [rows, setRows] = useState<ZaadTopupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Decision | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listZaadTopups("attention");
      setRows(res.topups);
      onSummary({ heldCents: res.heldCents, reversalLossCents: res.reversalLossCents });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [onSummary]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (reason: string) => {
    if (!deciding) return;
    const { row, kind } = deciding;
    if (kind === "customer" || kind === "agent") {
      await api.resolveZaadTopup(row.id, kind, reason);
      onNotice(
        kind === "customer"
          ? `${money(row.amountCents)} credited to ${row.customerName} from the agent's held float.`
          : `${money(row.amountCents)} returned to ${row.agentName}'s float. ${row.customerName} gets a strike.`
      );
    } else {
      const res = await api.decideZaadReversal(row.id, kind === "repay", reason);
      onNotice(
        "rejected" in res
          ? "Reversal report rejected. Nothing moved."
          : `${row.agentName}'s float repaid: ${money(res.fromCustomerCents)} from ${row.customerName}'s wallet, ${money(res.fromZappCents)} from Zapp. ${row.customerName} is blocked from agent top-ups.`
      );
    }
    setDeciding(null);
    await load();
  };

  const prompt = deciding && {
    customer: {
      title: `Credit ${money(deciding.row.amountCents)} to ${deciding.row.customerName}`,
      description:
        "Only when the agent's Zaad statement, or Telesom, shows the payment arrived. The money comes from the agent's held float; the agent earns no commission and the ruling counts against their standing.",
      confirm: "Credit the customer",
      danger: false,
    },
    agent: {
      title: `Return ${money(deciding.row.amountCents)} to ${deciding.row.agentName}`,
      description:
        "Only when there's no such payment on the agent's Zaad. The float goes back to the agent and the customer gets a strike; enough strikes block them.",
      confirm: "Return to the agent",
      danger: true,
    },
    repay: {
      title: `Repay ${deciding.row.agentName} for a reversal`,
      description:
        "Confirm with Telesom first that this payment was reversed. Zapp repays the agent's float in full: from what's left in the customer's wallet, the rest from Zapp. The customer is blocked from agent top-ups.",
      confirm: "Repay the agent",
      danger: true,
    },
    reject: {
      title: "Reject the reversal report",
      description: "Nothing moves. Say why, so the agent can be told.",
      confirm: "Reject",
      danger: false,
    },
  }[deciding.kind];

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Waiting on Zapp</strong>
        {rows.length > 0 && <span className="muted">{rows.length}</span>}
        <div className="spacer" />
        <button className="ghost" onClick={() => void load()}>
          <Icon name="refresh" size={16} />
          Refresh
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {loading ? (
        <Loading />
      ) : error ? null : rows.length === 0 ? (
        <EmptyState icon="check" title="Nothing waiting">
          No disputed top-ups and no reversal reports.
        </EmptyState>
      ) : (
        <div className="stack">
          {rows.map((row) => {
            const reversal = row.reversal?.status === "reported";
            return (
              <div key={row.id} className="panel">
                <div className="row">
                  <span>
                    <strong>{money(row.amountCents)}</strong>{" "}
                    <span className="muted">
                      {row.customerName} → {row.agentName ?? "—"}
                    </span>
                  </span>
                  {reversal ? <span className="badge bad">Reversal reported</span> : <StatusBadge status={row.status} />}
                  <div className="spacer" />
                  <button className="ghost" onClick={() => setOpen(open === row.id ? null : row.id)}>
                    {open === row.id ? "Hide details" : "Details"}
                  </button>
                  {reversal ? (
                    <>
                      <button onClick={() => setDeciding({ row, kind: "repay" })}>Repay the agent</button>
                      <button className="ghost" onClick={() => setDeciding({ row, kind: "reject" })}>
                        Reject
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setDeciding({ row, kind: "customer" })}>Credit the customer</button>
                      <button className="ghost" onClick={() => setDeciding({ row, kind: "agent" })}>
                        Return to agent
                      </button>
                    </>
                  )}
                </div>
                {open === row.id && <Timeline row={row} />}
              </div>
            );
          })}
        </div>
      )}

      {deciding && prompt && (
        <ReasonPrompt
          title={prompt.title}
          description={prompt.description}
          confirmLabel={prompt.confirm}
          danger={prompt.danger}
          onConfirm={decide}
          onCancel={() => setDeciding(null)}
        >
          <Timeline row={deciding.row} />
        </ReasonPrompt>
      )}
    </div>
  );
}

// --------------------------------------------------------------- requests

function RequestsPanel() {
  const [view, setView] = useState<"open" | "recent">("open");
  const [rows, setRows] = useState<ZaadTopupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows((await api.listZaadTopups(view)).topups);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Top-ups</strong>
        <div className="segmented" role="group" aria-label="Which top-ups">
          <button aria-pressed={view === "open"} onClick={() => setView("open")}>
            In progress
          </button>
          <button aria-pressed={view === "recent"} onClick={() => setView("recent")}>
            Latest 100
          </button>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={() => void load()}>
          <Icon name="refresh" size={16} />
          Refresh
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {loading ? (
        <Loading />
      ) : error ? null : rows.length === 0 ? (
        <EmptyState icon="inbox" title={view === "open" ? "Nothing in progress" : "No top-ups yet"} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="wide">Customer</th>
                <th className="wide">Agent</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Zaad ID</th>
                <th>Asked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="wide">
                    {row.customerName}
                    <div className="muted">{row.customerPhone ?? row.customerId}</div>
                  </td>
                  <td className="wide">
                    {row.agentName ?? <span className="muted">{row.offers} offered</span>}
                    {row.agentReceiveNumber && <div className="muted">{row.agentReceiveNumber}</div>}
                  </td>
                  <td className="num">{money(row.amountCents)}</td>
                  <td>
                    <StatusBadge status={row.status} />
                    {row.reversal && <div className="muted">reversal {row.reversal.status}</div>}
                  </td>
                  <td className="nowrap">{row.customerZaadTxnId ?? "—"}</td>
                  <td className="nowrap">{ago(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- agents

interface Editing {
  agentId: string;
  name: string;
  number: string;
  enabled: boolean;
  isNew: boolean;
  previousNumber: string | null;
}

function AgentsPanel({ onNotice }: { onNotice: (s: string) => void }) {
  const [rows, setRows] = useState<ZaadAgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<UserSummary[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows((await api.listZaadAgents()).agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agents");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const search = async () => {
    if (query.trim().length < 3) return;
    setSearching(true);
    try {
      const found = await api.searchUsers(query.trim());
      setMatches(found.filter((u) => u.accountType === "topup_agent" || u.accountType === "agent_merchant"));
    } finally {
      setSearching(false);
    }
  };

  const save = async (reason: string) => {
    if (!editing) return;
    const res = await api.setZaadAgent({
      agentId: editing.agentId,
      receiveMsisdn: editing.number,
      enabled: editing.enabled,
      reason,
    });
    onNotice(
      `${editing.name} receives Zaad top-ups on ${res.receiveNumber}${res.enabled ? "" : " (switched off)"}.` +
        (res.pausedUntil ? ` New number: no offers until ${new Date(res.pausedUntil).toLocaleString()}.` : "")
    );
    setEditing(null);
    setMatches([]);
    setQuery("");
    await load();
  };

  const online = rows.filter((r) => r.online).length;
  const numberChanged = editing && !editing.isNew && editing.previousNumber && editing.previousNumber !== editing.number;

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Agents</strong>
        {rows.length > 0 && (
          <span className="muted">
            {online} online · {rows.length} set up
          </span>
        )}
        <div className="spacer" />
        <button className="ghost" onClick={() => void load()}>
          <Icon name="refresh" size={16} />
          Refresh
        </button>
      </div>

      <div className="stack">
        <span className="muted">
          Set up an agent after seeing their Zaad account open on their own phone. Find them by phone number or name:
        </span>
        <div className="row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Agent's phone number or name"
            onKeyDown={(e) => e.key === "Enter" && void search()}
          />
          <button onClick={() => void search()} disabled={searching}>
            <Icon name="search" size={16} />
            Find agent
          </button>
        </div>
        {matches.length === 0 && query.trim().length >= 3 && !searching && (
          <span className="hint">Only agent accounts are listed. A customer must be approved as an agent first.</span>
        )}
        {matches.map((m) => (
          <button
            key={m.userId}
            className="ghost"
            onClick={() =>
              setEditing({
                agentId: m.userId,
                name: m.fullName || m.phoneNumber || m.userId,
                number: rows.find((r) => r.id === m.userId)?.receiveNumber ?? "",
                enabled: true,
                isNew: !rows.some((r) => r.id === m.userId),
                previousNumber: rows.find((r) => r.id === m.userId)?.receiveNumber ?? null,
              })
            }
          >
            {m.fullName || "No name"} · {m.phoneNumber || m.userId}
          </button>
        ))}
      </div>

      {error && <div className="banner error">{error}</div>}
      {loading ? (
        <Loading />
      ) : error ? null : rows.length === 0 ? (
        <EmptyState icon="user" title="No agents set up yet" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="wide">Agent</th>
                <th>Receives on</th>
                <th className="num">Float</th>
                <th>Status</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="wide">
                    {row.name}
                    <div className="muted">{row.phone ?? row.id}</div>
                  </td>
                  <td className="nowrap">
                    {row.receiveNumber ?? "—"}
                    <div className="muted">checked {ago(row.verifiedAt)}</div>
                  </td>
                  <td className="num">{money(row.floatCents)}</td>
                  <td>
                    {!row.enabled ? (
                      <span className="badge">Off</span>
                    ) : row.flagged ? (
                      <span className="badge bad">Flagged</span>
                    ) : row.pausedUntil ? (
                      <span className="badge warn">Paused until {new Date(row.pausedUntil).toLocaleString()}</span>
                    ) : row.openRequestId ? (
                      <span className="badge warn">Busy</span>
                    ) : row.online ? (
                      <span className="badge ok">Online</span>
                    ) : (
                      <span className="badge">Offline</span>
                    )}
                  </td>
                  <td className="nowrap">{ago(row.lastSeenAt)}</td>
                  <td className="actions">
                    <button
                      className="ghost"
                      onClick={() =>
                        setEditing({
                          agentId: row.id,
                          name: row.name,
                          number: row.receiveNumber ?? "",
                          enabled: row.enabled,
                          isNew: false,
                          previousNumber: row.receiveNumber,
                        })
                      }
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ReasonPrompt
          title={editing.isNew ? `Set up ${editing.name} for Zaad top-ups` : `Edit ${editing.name}`}
          description="Customers will pay this number by Zaad, and the agent's float pays their wallet. Only enter a number you've seen open on the agent's own phone."
          confirmLabel="Save"
          confirmDisabled={editing.number.replace(/\D/g, "").length < 9}
          onConfirm={save}
          onCancel={() => setEditing(null)}
        >
          <div className="stack">
            <label className="stack">
              <span>Receiving Zaad number</span>
              <input
                value={editing.number}
                onChange={(e) => setEditing({ ...editing, number: e.target.value })}
                placeholder="063 412 3456"
                inputMode="tel"
              />
            </label>
            {numberChanged && (
              <div className="banner">
                A new number pauses this agent for the time set on the Pricing & rules page.
              </div>
            )}
            <label className="row">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              />
              <span>Can take Zaad top-ups</span>
            </label>
          </div>
        </ReasonPrompt>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- unblock

function UnblockPanel({ onNotice }: { onNotice: (s: string) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<UserSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<UserSummary | null>(null);

  const search = async () => {
    if (query.trim().length < 3) return;
    setSearching(true);
    try {
      setMatches(await api.searchUsers(query.trim()));
    } finally {
      setSearching(false);
    }
  };

  const clear = async (reason: string) => {
    if (!chosen) return;
    await api.clearZaadCustomer(chosen.userId, reason);
    onNotice(`${chosen.fullName || chosen.phoneNumber || chosen.userId} can use agent top-ups again.`);
    setChosen(null);
    setMatches([]);
    setQuery("");
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Unblock a customer</strong>
      </div>
      <div className="stack">
        <span className="muted">
          Customers are blocked from agent top-ups after lost disputes or a confirmed reversal. Unblock only once
          you've spoken to them.
        </span>
        <div className="row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Customer's phone number or name"
            onKeyDown={(e) => e.key === "Enter" && void search()}
          />
          <button onClick={() => void search()} disabled={searching}>
            <Icon name="search" size={16} />
            Find
          </button>
        </div>
        {matches.map((m) => (
          <button key={m.userId} className="ghost" onClick={() => setChosen(m)}>
            {m.fullName || "No name"} · {m.phoneNumber || m.userId}
          </button>
        ))}
      </div>
      {chosen && (
        <ReasonPrompt
          title={`Unblock ${chosen.fullName || chosen.phoneNumber || "this customer"}`}
          description="Clears their lost disputes and any block, so they can ask agents for Zaad top-ups again."
          confirmLabel="Unblock"
          onConfirm={clear}
          onCancel={() => setChosen(null)}
        />
      )}
    </div>
  );
}
