import { incomeCents } from "../wallet/getTransactionSummary";
import { Transaction } from "../types";

const agent = "agent-1";
const row = (over: Partial<Transaction>) =>
  ({ type: "topup", fromUserId: agent, toUserId: "cust-1", amount: 1500, commissionCents: 30, ...over }) as Transaction;

describe("getTransactionSummary incomeCents", () => {
  it("counts a dollar top-up's commission", () => {
    expect(incomeCents(row({ currency: "USD" }), agent)).toBe(30);
    expect(incomeCents(row({}), agent)).toBe(30); // older rows carry no currency
  });

  it("ignores shilling rows, which the dollar summary cannot add", () => {
    expect(incomeCents(row({ currency: "SLS", amount: 400000, commissionCents: 8000 }), agent)).toBe(0);
    expect(
      incomeCents({ type: "payment", toUserId: agent, fromUserId: "c", amount: 25000, currency: "SLS" } as Transaction, agent)
    ).toBe(0);
  });
});
