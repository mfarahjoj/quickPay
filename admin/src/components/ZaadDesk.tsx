import { useCallback, useEffect, useState } from "react";
import {
  api,
  type CollectionEntry,
  type HeldPayment,
  type ListenerPhone,
  type ListenerSms,
  type UserSummary,
} from "../api";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { EmptyState, Loading } from "./ui";

function money(cents: number, currency = "USD") {
  return currency === "USD" ? `$${(cents / 100).toFixed(2)}` : `${cents.toLocaleString()} ${currency}`;
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

/** "+252634123456" → "063 412 3456". */
function local(msisdn: string | null) {
  const m = msisdn ? /^\+252(\d{2})(\d{3})(\d{4})$/.exec(msisdn) : null;
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : msisdn ?? "—";
}

const REASONS: Record<string, string> = {
  unknown_sender: "Number not linked to anyone",
  below_min: "Below the smallest top-up",
  above_max: "Above the largest top-up",
  currency: "Shillings (not credited yet)",
  no_wallet: "Customer has no wallet",
};

/**
 * Zaad and eDahab top-ups through the collection number.
 *
 * Money that reached the collection SIM but couldn't be credited sits in
 * platform:mm_suspense. Each held payment is either given to the customer it
 * belongs to, or sent back to the sender from the collection SIM first and
 * then recorded here with that send's reference. Below that: texts the reader
 * couldn't read, the collection numbers, and the listener phones.
 */
export function ZaadDesk({ isSuper }: { isSuper: boolean }) {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}
      <HeldPanel onNotice={setNotice} />
      <TextsPanel />
      <CollectionPanel isSuper={isSuper} onNotice={setNotice} />
      <ListenersPanel isSuper={isSuper} />
    </div>
  );
}

// ------------------------------------------------------------ held payments

function HeldPanel({ onNotice }: { onNotice: (s: string) => void }) {
  const [rows, setRows] = useState<HeldPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<HeldPayment | null>(null);
  const [refunding, setRefunding] = useState<HeldPayment | null>(null);
  const [reference, setReference] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<UserSummary[]>([]);
  const [chosen, setChosen] = useState<UserSummary | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listHeldMobileMoney());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load held payments");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openAssign = async (row: HeldPayment) => {
    setAssigning(row);
    setChosen(null);
    setMatches([]);
    setQuery(row.senderMsisdn);
    if (row.suggestedUid) {
      try {
        const u = await api.getUser(row.suggestedUid);
        const profile = u.profile as { fullName?: string; phoneNumber?: string };
        setChosen({
          userId: u.userId,
          fullName: profile.fullName,
          phoneNumber: profile.phoneNumber,
          accountStatus: u.accountStatus,
        });
      } catch {
        // No suggestion then; search instead.
      }
    }
  };

  const search = async () => {
    if (query.trim().length < 3) return;
    setSearching(true);
    try {
      setMatches(await api.searchUsers(query.trim()));
    } finally {
      setSearching(false);
    }
  };

  const assign = async (reason: string) => {
    if (!assigning || !chosen) return;
    await api.assignMobileMoney(assigning.receiptId, chosen.userId, reason);
    onNotice(`${money(assigning.amountCents)} credited to ${chosen.fullName || chosen.phoneNumber || chosen.userId}.`);
    setAssigning(null);
    await load();
  };

  const refund = async (reason: string) => {
    if (!refunding) return;
    await api.refundMobileMoney(refunding.receiptId, reference.trim(), reason);
    onNotice(`Recorded ${money(refunding.amountCents)} as sent back to ${local(refunding.senderMsisdn)}.`);
    setRefunding(null);
    setReference("");
    await load();
  };

  const total = rows.reduce((sum, r) => sum + (r.currency === "USD" ? r.amountCents : 0), 0);

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Held payments</strong>
        {rows.length > 0 && <span className="muted">{rows.length} · {money(total)} waiting</span>}
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
        <EmptyState icon="check" title="Nothing held">
          Every payment to the collection number has been credited.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="wide">From</th>
                <th className="num">Amount</th>
                <th className="wide">Why it's held</th>
                <th>Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.receiptId}>
                  <td className="wide">
                    {local(row.senderMsisdn)}
                    <div className="muted">
                      {row.senderName || "no name"} · {row.provider} {row.operatorTxnId}
                    </div>
                  </td>
                  <td className="num">{money(row.amountCents, row.currency)}</td>
                  <td className="wide">
                    {REASONS[row.reason] ?? row.reason}
                    {row.suggestedUid && <div className="muted">probably a known customer</div>}
                  </td>
                  <td className="nowrap">{when(row.receivedAt)}</td>
                  <td className="actions">
                    <div className="row">
                      <button disabled={row.currency !== "USD"} onClick={() => void openAssign(row)}>
                        Credit a customer
                      </button>
                      <button
                        className="ghost"
                        onClick={() => {
                          setReference("");
                          setRefunding(row);
                        }}
                      >
                        Sent back
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assigning && (
        <ReasonPrompt
          title={`Credit ${money(assigning.amountCents)} to a customer`}
          description={`From ${local(assigning.senderMsisdn)}${assigning.senderName ? ` (${assigning.senderName})` : ""}. Only credit it to the person who sent it — if you're not sure who that is, send it back instead.`}
          confirmLabel="Credit their wallet"
          confirmDisabled={!chosen}
          onConfirm={assign}
          onCancel={() => setAssigning(null)}
        >
          <div className="stack">
            {chosen ? (
              <div className="row">
                <span>
                  <strong>{chosen.fullName || "No name"}</strong>
                  <span className="muted"> · {chosen.phoneNumber || chosen.userId}</span>
                </span>
                <div className="spacer" />
                <button className="ghost" onClick={() => setChosen(null)}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="row">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Phone number or name"
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
              </>
            )}
          </div>
        </ReasonPrompt>
      )}

      {refunding && (
        <ReasonPrompt
          title={`Record ${money(refunding.amountCents, refunding.currency)} as sent back`}
          description={`Send it back first, from the collection SIM, to ${local(refunding.senderMsisdn)}. Then enter that send's transaction ID — it's what matches this to the Zaad statement later.`}
          confirmLabel="Record as sent back"
          confirmDisabled={reference.trim().length < 3}
          onConfirm={refund}
          onCancel={() => {
            setRefunding(null);
            setReference("");
          }}
        >
          <label className="stack">
            <span>Transaction ID of the send back</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TX123456" />
          </label>
        </ReasonPrompt>
      )}
    </div>
  );
}

// ------------------------------------------------------------- unread texts

function TextsPanel() {
  const [status, setStatus] = useState<ListenerSms["status"]>("unparsed");
  const [rows, setRows] = useState<ListenerSms[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listListenerSms(status));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load texts");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Texts that didn't become a payment</strong>
        <div className="segmented" role="group" aria-label="Text status">
          {(["unparsed", "failed", "ignored"] as const).map((s) => (
            <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === "unparsed" ? "Couldn't read" : s === "failed" ? "Failed" : "Not from the operator"}
            </button>
          ))}
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
        <EmptyState icon="inbox" title="None" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th className="wide">Text</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="nowrap">
                    {row.from}
                    <div className="muted">{row.provider}</div>
                  </td>
                  <td className="wide" style={{ whiteSpace: "pre-wrap" }}>
                    {row.body}
                  </td>
                  <td className="nowrap">{when(row.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ padding: "0 20px 16px" }}>
        "Couldn't read" texts move no money. If one is a real payment, it needs the reader updated for that
        wording; its money is credited once the text is processed again.
      </p>
    </div>
  );
}

// ------------------------------------------------------- collection numbers

function CollectionPanel({ isSuper, onNotice }: { isSuper: boolean; onNotice: (s: string) => void }) {
  const [data, setData] = useState<{ zaad: CollectionEntry; edahab: CollectionEntry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<"zaad" | "edahab" | null>(null);
  const [number, setNumber] = useState("");
  const [senders, setSenders] = useState("");
  const [active, setActive] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.getCollection());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load collection numbers");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (p: "zaad" | "edahab") => {
    const e = data?.[p];
    setNumber(e?.number ? local(e.number) : "");
    setSenders((e?.senderIds ?? []).join(", "));
    setActive(e?.active ?? false);
    setEditing(p);
  };

  const save = async (reason: string) => {
    if (!editing) return;
    await api.updateCollection(
      editing,
      { number, active, senderIds: senders.split(",").map((s) => s.trim()).filter(Boolean) },
      reason
    );
    onNotice(`${editing === "zaad" ? "Zaad" : "eDahab"} collection settings saved.`);
    setEditing(null);
    await load();
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Collection numbers</strong>
      </div>
      {error && <div className="banner error">{error}</div>}
      {!data ? (
        error ? null : <Loading />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rail</th>
                <th className="wide">Number</th>
                <th className="wide">Operator sender IDs</th>
                <th>Top-ups</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(["zaad", "edahab"] as const).map((p) => (
                <tr key={p}>
                  <td>{p === "zaad" ? "Zaad" : "eDahab"}</td>
                  <td className="wide">{local(data[p].number)}</td>
                  <td className="wide">{data[p].senderIds.join(", ") || "—"}</td>
                  <td>{data[p].active ? "On" : "Off"}</td>
                  <td className="actions">
                    {isSuper && (
                      <button className="ghost" onClick={() => edit(p)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ReasonPrompt
          title={`${editing === "zaad" ? "Zaad" : "eDahab"} collection settings`}
          description="Customers send top-ups to this number, and only texts from these sender IDs are read. Switching top-ups on shows the option in the app."
          confirmLabel="Save"
          onConfirm={save}
          onCancel={() => setEditing(null)}
        >
          <label className="stack">
            <span>Collection number</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="063 412 3456" />
          </label>
          <label className="stack">
            <span>Sender IDs, exactly as the operator's texts show them (comma-separated)</span>
            <input value={senders} onChange={(e) => setSenders(e.target.value)} placeholder="Zaad" />
          </label>
          <label className="row">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Customers can top up through this number</span>
          </label>
        </ReasonPrompt>
      )}
    </div>
  );
}

// ---------------------------------------------------------- listener phones

function ListenersPanel({ isSuper }: { isSuper: boolean }) {
  const [rows, setRows] = useState<ListenerPhone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<"zaad" | "edahab">("zaad");
  const [issued, setIssued] = useState<{ deviceId: string; key: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listListeners());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load listener phones");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const register = async () => {
    const result = await api.registerListener(provider, label.trim());
    setIssued({ deviceId: result.deviceId, key: result.key });
    setRegistering(false);
    setLabel("");
    await load();
  };

  // Heartbeats come every minute; ten minutes of silence means it's down.
  const quiet = (ms: number | null) => !ms || Date.now() - ms > 10 * 60_000;

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Listener phones</strong>
        <div className="spacer" />
        {isSuper && <button onClick={() => setRegistering(true)}>Register a phone</button>}
        <button className="ghost" onClick={() => void load()}>
          <Icon name="refresh" size={16} />
          Refresh
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}

      {issued && (
        <div className="banner ok" style={{ margin: "0 20px 16px" }}>
          <div className="stack">
            <strong>Enter these in the Zapp listener app now. The key is not shown again.</strong>
            <span>
              Device ID: <code>{issued.deviceId}</code>
            </span>
            <span>
              Key: <code>{issued.key}</code>
            </span>
            <button className="ghost" onClick={() => setIssued(null)}>
              I've entered them
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : error ? null : rows.length === 0 ? (
        <EmptyState icon="alert" title="No listener phone yet">
          Without one, no top-up through the collection number is credited.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="wide">Phone</th>
                <th>Rail</th>
                <th>Last heard from</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.deviceId}>
                  <td className="wide">
                    {row.label}
                    <div className="muted">{row.deviceId}</div>
                  </td>
                  <td>{row.provider}</td>
                  <td className="nowrap" style={quiet(row.lastSeenAt) ? { color: "var(--warn)", fontWeight: 500 } : undefined}>
                    {ago(row.lastSeenAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {registering && (
        <ReasonPrompt
          title="Register a listener phone"
          description="This makes a device ID and a signing key for the phone holding the collection SIM. Each phone gets its own; the key is shown once, right after this."
          confirmLabel="Register"
          confirmDisabled={label.trim().length < 2}
          onConfirm={async () => register()}
          onCancel={() => setRegistering(false)}
        >
          <label className="stack">
            <span>Name for this phone</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Office Samsung, Zaad SIM" />
          </label>
          <label className="stack">
            <span>Rail</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as "zaad" | "edahab")}>
              <option value="zaad">Zaad</option>
              <option value="edahab">eDahab</option>
            </select>
          </label>
        </ReasonPrompt>
      )}
    </div>
  );
}
