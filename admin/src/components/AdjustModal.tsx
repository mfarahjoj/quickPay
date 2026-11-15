import { useState } from "react";
import { api, formatFloat, type FloatCurrency } from "../api";
import { ReasonPrompt } from "./ReasonPrompt";

/** Where a correction's other side comes from or goes to. */
const COUNTER_ACCOUNTS = [
  { id: "platform:fees", label: "Platform fees (Zapp's revenue)" },
  { id: "platform:promo", label: "Platform promo (bonuses, goodwill)" },
  { id: "float:agents", label: "Agent cash float" },
  { id: "float:bank", label: "Bank float" },
  { id: "float:zaad", label: "Zaad float" },
  { id: "float:edahab", label: "eDahab float" },
];

/**
 * Correct one wallet through the ledger: a balanced `adjustment` entry
 * against a platform or float account, never a balance edit.
 *
 * The idempotency key is minted when the dialog opens and reused on every
 * retry, so a click whose response was lost can't post twice.
 */
export function AdjustModal({
  userId,
  name,
  onDone,
  onCancel,
}: {
  userId: string;
  name: string;
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  // Shillings or dollars: a correction moves one, never converted.
  const [currency, setCurrency] = useState<FloatCurrency>("USD");
  const [amount, setAmount] = useState("");
  const [counter, setCounter] = useState(COUNTER_ACCOUNTS[0].id);
  const [key] = useState(() => crypto.randomUUID());

  // In the smallest unit: cents, or whole shillings.
  const amountCents =
    currency === "SLS" ? Math.floor(Number(amount || "0")) : Math.round(parseFloat(amount || "0") * 100);
  const valid = Number.isFinite(amountCents) && amountCents > 0;
  const wallet = `user:${userId}`;

  const post = async (reason: string) => {
    const res = await api.postAdjustment({
      debitAccount: direction === "credit" ? counter : wallet,
      creditAccount: direction === "credit" ? wallet : counter,
      amountCents,
      currency,
      reason,
      idempotencyKey: key,
    });
    await onDone(
      res.alreadyPosted
        ? "That correction was already posted."
        : `${direction === "credit" ? "Added" : "Took"} ${formatFloat(amountCents, currency)} ${
            direction === "credit" ? "to" : "from"
          } ${name}'s wallet (${res.journalEntryId}).`
    );
  };

  return (
    <ReasonPrompt
      title="Correct this balance"
      description="Posts a balanced adjustment entry and tells the customer their balance was corrected. Large corrections, counted over 24 hours, need a senior admin. Holds can't be adjusted here."
      confirmLabel={direction === "credit" ? "Add to wallet" : "Take from wallet"}
      danger={direction === "debit"}
      confirmDisabled={!valid}
      onConfirm={post}
      onCancel={onCancel}
    >
      <div className="segmented" role="group" aria-label="Direction" style={{ marginBottom: 12 }}>
        <button aria-pressed={direction === "credit"} onClick={() => setDirection("credit")}>
          Add to wallet
        </button>
        <button aria-pressed={direction === "debit"} onClick={() => setDirection("debit")}>
          Take from wallet
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Currency" style={{ marginBottom: 12 }}>
        <button aria-pressed={currency === "SLS"} onClick={() => { setCurrency("SLS"); setAmount(""); }}>
          Shillings
        </button>
        <button aria-pressed={currency === "USD"} onClick={() => { setCurrency("USD"); setAmount(""); }}>
          Dollars
        </button>
      </div>
      <label className="stack">
        <span className="muted">Amount ({currency === "SLS" ? "whole shillings" : "USD"})</span>
        <input
          inputMode={currency === "SLS" ? "numeric" : "decimal"}
          value={amount}
          onChange={(e) =>
            setAmount(currency === "SLS" ? e.target.value.split(".")[0].replace(/[^0-9]/g, "") : e.target.value)
          }
          placeholder={currency === "SLS" ? "0,000" : "0.00"}
        />
      </label>
      <label className="stack" style={{ marginTop: 12 }}>
        <span className="muted">{direction === "credit" ? "Paid from" : "Paid into"}</span>
        <select value={counter} onChange={(e) => setCounter(e.target.value)}>
          {COUNTER_ACCOUNTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
    </ReasonPrompt>
  );
}
