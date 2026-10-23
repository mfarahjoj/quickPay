import { counterCashOutEntryId, counterCashOutLines, isPurpose, mayRaise } from "../customer-qr/counterCashOut";
import { validateEntry } from "../ledger/validate";

const sum = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((s, l) => s + l.debit - l.credit, 0);

describe("cash-out at the counter", () => {
  it("moves the amount from the customer to the agent's float", () => {
    expect(counterCashOutLines({ customerId: "c1", agentId: "a1", amount: 1000, feeCents: 0, commissionCents: 0 }))
      .toEqual([
        { account: "user:c1", debit: 1000, credit: 0 },
        { account: "agent:a1", debit: 0, credit: 1000 },
      ]);
  });

  it("takes the fee from the customer on top and pays the agent's commission from fees", () => {
    const lines = counterCashOutLines({ customerId: "c1", agentId: "a1", amount: 1000, feeCents: 10, commissionCents: 20 });
    expect(lines).toEqual([
      { account: "user:c1", debit: 1010, credit: 0 },
      { account: "agent:a1", debit: 0, credit: 1000 },
      { account: "platform:fees", debit: 0, credit: 10 },
      { account: "platform:fees", debit: 20, credit: 0 },
      { account: "user:a1", debit: 0, credit: 20 },
    ]);
  });

  it("is always a valid, zero-sum entry", () => {
    for (const [feeCents, commissionCents] of [[0, 0], [10, 0], [0, 20], [10, 20]]) {
      const lines = counterCashOutLines({ customerId: "c1", agentId: "a1", amount: 1000, feeCents, commissionCents });
      expect(sum(lines)).toBe(0);
      expect(() =>
        validateEntry({
          entryId: counterCashOutEntryId("r1"),
          type: "agent_cashout",
          currency: "USD",
          lines,
          description: "Cash-out at an agent",
          postedBy: "c1",
        })
      ).not.toThrow();
    }
  });

  it("is keyed by the request, so it posts once", () => {
    expect(counterCashOutEntryId("r1")).toBe("counterco_r1");
  });
});

describe("who may raise what", () => {
  it("lets agents pay out cash and shops charge", () => {
    expect(mayRaise("topup_agent", "cash_out")).toBe(true);
    expect(mayRaise("agent_merchant", "cash_out")).toBe(true);
    expect(mayRaise("merchant", "cash_out")).toBe(false);
    expect(mayRaise("customer", "cash_out")).toBe(false);
    expect(mayRaise("merchant", "payment")).toBe(true);
    expect(mayRaise("agent_merchant", "payment")).toBe(true);
    expect(mayRaise("topup_agent", "payment")).toBe(false);
    expect(mayRaise(undefined, "payment")).toBe(false);
  });

  it("knows only the two purposes", () => {
    expect(isPurpose("cash_out")).toBe(true);
    expect(isPurpose("payment")).toBe(true);
    expect(isPurpose("refund")).toBe(false);
  });
});
