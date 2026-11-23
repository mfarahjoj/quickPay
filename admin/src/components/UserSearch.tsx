import { useEffect, useState } from "react";
import { api, type UserSummary } from "../api";
import { Avatar, EmptyState } from "./ui";

interface Props {
  selectedId?: string;
  onSelect: (userId: string) => void;
  /** A search started elsewhere (the sidebar's quick find); runs on each new nonce. */
  autoQuery?: { text: string; nonce: number };
}

export function UserSearch({ selectedId, onSelect, autoQuery }: Props) {
  const [query, setQuery] = useState(autoQuery?.text ?? "");
  const [results, setResults] = useState<UserSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (text: string) => {
    if (text.trim().length < 3) {
      setError("Enter at least 3 characters");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await api.searchUsers(text.trim());
      setResults(found);
      // One match is the person you meant: open them without another click.
      if (found.length === 1) onSelect(found[0].userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query);
  };

  useEffect(() => {
    if (!autoQuery?.text) return;
    setQuery(autoQuery.text);
    void runSearch(autoQuery.text);
    // Only a new quick-find request should search again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoQuery?.nonce]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Find a customer</h2>
      </div>

      <form onSubmit={search} className="search-form">
        <div className="search-field">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="+252… , uid, receipt (ZP-…), or name"
            aria-label="Search customers"
            autoFocus={!autoQuery}
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>

      <p className="hint" style={{ marginTop: 10 }}>
        Phone and uid match exactly. Names match from the start.
      </p>

      {error && (
        <div className="banner error" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}

      {results && results.length === 0 && (
        <EmptyState icon="search" title="No matches" />
      )}

      {results && results.length > 0 && (
        <div className="list">
          {results.map((u) => (
            <button
              key={u.userId}
              className={`item${u.userId === selectedId ? " selected" : ""}`}
              onClick={() => onSelect(u.userId)}
            >
              <Avatar name={u.fullName} />
              <div className="item-text">
                <div className="name">{u.fullName || "(no name)"}</div>
                <div className="sub">
                  {u.phoneNumber || "(no phone)"} · {u.accountType || "customer"}
                  {u.accountStatus !== "active" && ` · ${u.accountStatus}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
