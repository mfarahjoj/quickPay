import { useState } from "react";
import { api, type UserSummary } from "../api";
import { Avatar, EmptyState } from "./ui";

interface Props {
  selectedId?: string;
  onSelect: (userId: string) => void;
}

export function UserSearch({ selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 3) {
      setError("Enter at least 3 characters");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResults(await api.searchUsers(query.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

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
            placeholder="+252… , uid, or name"
            aria-label="Search customers"
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
