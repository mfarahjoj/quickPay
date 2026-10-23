import { JournalLine, PLATFORM_FEES, agentAccount, userAccount } from "../ledger";

/**
 * Cash-out at the counter (CASH_IN_CASH_OUT.md): an agent scans the customer's
 * receive QR and raises a cash-out request; the customer approves it with
 * their PIN while standing there, and the agent hands over the cash.
 *
 * Nothing is held beforehand. At approval one entry moves the amount from the
 * customer to the agent's float (the agent's cash is now in the customer's
 * hand, the customer's e-money in the agent's float), takes any cash-out fee
 * from the customer on top, and pays the agent's commission out of
 * platform:fees — the same accounts and rates as the code-based cash-out.
 */
export interface CounterCashOut {
  customerId: string;
  agentId: string;
  /** Cash handed over, in cents. */
  amount: number;
  /** Charged to the customer on top of the amount (`cashOutFeeRate`). */
  feeCents: number;
  /** Paid to the agent by Zapp (`cashOutCommissionRate`), 0 on a round trip. */
  commissionCents: number;
}

export function counterCashOutEntryId(requestId: string): string {
  return `counterco_${requestId}`;
}

export function counterCashOutLines(c: CounterCashOut): JournalLine[] {
  const lines: JournalLine[] = [
    { account: userAccount(c.customerId), debit: c.amount + c.feeCents, credit: 0 },
    { account: agentAccount(c.agentId), debit: 0, credit: c.amount },
  ];
  if (c.feeCents > 0) lines.push({ account: PLATFORM_FEES, debit: 0, credit: c.feeCents });
  if (c.commissionCents > 0) {
    lines.push({ account: PLATFORM_FEES, debit: c.commissionCents, credit: 0 });
    lines.push({ account: userAccount(c.agentId), debit: 0, credit: c.commissionCents });
  }
  return lines;
}

/** Accounts allowed to raise each kind of request against a customer's QR. */
export const CAN_CHARGE = ["merchant", "agent_merchant"] as const;
export const CAN_CASH_OUT = ["topup_agent", "agent_merchant"] as const;

export type RequestPurpose = "payment" | "cash_out";

export function isPurpose(v: unknown): v is RequestPurpose {
  return v === "payment" || v === "cash_out";
}

/** Whether an account of [accountType] may raise a request for [purpose]. */
export function mayRaise(accountType: string | undefined, purpose: RequestPurpose): boolean {
  const allowed: readonly string[] = purpose === "cash_out" ? CAN_CASH_OUT : CAN_CHARGE;
  return typeof accountType === "string" && allowed.includes(accountType);
}
