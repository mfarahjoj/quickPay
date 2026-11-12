import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore } from "./helpers/fakeFirestore";
import {
  analyzeActivity,
  runActivityMonitor,
  DEFAULT_MONITOR_THRESHOLDS,
  MonitoredEntry,
} from "../ledger/activityMonitor";

const AGENT = "user:agent-1";
const AGENT_2 = "user:agent-2";
const CUSTOMER = "user:cust-1";
const MERCHANT = "user:merch-1";
const FEES = "platform:fees";
const HOLD = "platform:cashout_hold";

// Entries shaped exactly as the flows post them.

/** agentConfirmTopup / manualTopup: float out, value in, commission back. */
const cashIn = (id: string, agent: string, customer: string, cents: number): MonitoredEntry => ({
  id,
  type: "agent_topup",
  lines: [
    { account: agent, debit: cents, credit: 0 },
    { account: customer, debit: 0, credit: cents },
    { account: FEES, debit: cents * 0.02, credit: 0 },
    { account: agent, debit: 0, credit: cents * 0.02 },
  ],
});

const p2p = (id: string, from: string, to: string, cents: number): MonitoredEntry => ({
  id,
  type: "p2p",
  lines: [
    { account: from, debit: cents, credit: 0 },
    { account: to, debit: 0, credit: cents },
  ],
});

/** qr_payment: customer pays gross, merchant gets net, platform the 1% fee. */
const shopPayment = (id: string, from: string, to: string, cents: number): MonitoredEntry => ({
  id,
  type: "qr_payment",
  lines: [
    { account: from, debit: cents, credit: 0 },
    { account: to, debit: 0, credit: cents * 0.99 },
    { account: FEES, debit: 0, credit: cents * 0.01 },
  ],
});

/** agentConfirmCashOut settle: hold → agent, plus commission. */
const cashOutSettle = (
  id: string,
  agent: string,
  customer: string,
  cents: number
): MonitoredEntry => ({
  id,
  type: "agent_cashout",
  customer,
  lines: [
    { account: HOLD, debit: cents, credit: 0 },
    { account: agent, debit: 0, credit: cents },
    { account: FEES, debit: cents * 0.02, credit: 0 },
    { account: agent, debit: 0, credit: cents * 0.02 },
  ],
});

const kinds = (entries: MonitoredEntry[]) => analyzeActivity(entries).map((f) => f.kind);

describe("analyzeActivity", () => {
  it("says nothing about an ordinary day", () => {
    expect(
      kinds([
        cashIn("t1", AGENT, CUSTOMER, 5_000),
        shopPayment("q1", CUSTOMER, MERCHANT, 3_000),
        p2p("p1", MERCHANT, CUSTOMER, 1_000),
      ])
    ).toEqual([]);
  });

  describe("self_dealing", () => {
    it("flags the self top-up shape: agent on both sides, net up by the commission", () => {
      const findings = analyzeActivity([cashIn("t1", AGENT, AGENT, 100_000)]);
      expect(findings).toEqual([
        expect.objectContaining({
          kind: "self_dealing",
          account: AGENT,
          amount: 2_000,
          entryIds: ["t1"],
        }),
      ]);
    });

    it("does not flag a legitimate cash-in, where the agent nets down", () => {
      expect(kinds([cashIn("t1", AGENT, CUSTOMER, 100_000)])).not.toContain("self_dealing");
    });
  });

  describe("agent_commission", () => {
    it("flags an account over the daily commission threshold", () => {
      // 26 × $100 at 2% = $52 > $50
      const entries = Array.from({ length: 26 }, (_, i) =>
        cashIn(`t${i}`, AGENT, CUSTOMER, 10_000)
      );
      const finding = analyzeActivity(entries).find((f) => f.kind === "agent_commission");
      expect(finding).toEqual(
        expect.objectContaining({ account: AGENT, amount: 5_200, count: 26 })
      );
      expect(finding!.entryIds).toHaveLength(10);
    });

    it("counts cash-out commission too", () => {
      const entries = Array.from({ length: 26 }, (_, i) =>
        cashOutSettle(`c${i}`, AGENT, `user:c${i}`, 10_000)
      );
      expect(kinds(entries)).toContain("agent_commission");
    });

    it("stays quiet at the threshold", () => {
      const entries = Array.from({ length: 25 }, (_, i) =>
        cashIn(`t${i}`, AGENT, CUSTOMER, 10_000)
      );
      expect(kinds(entries)).not.toContain("agent_commission");
    });

    it("does not count a refund's fee reversal as commission", () => {
      const refund: MonitoredEntry = {
        id: "r1",
        type: "refund",
        lines: [
          { account: MERCHANT, debit: 990_000, credit: 0 },
          { account: FEES, debit: 10_000, credit: 0 },
          { account: CUSTOMER, debit: 0, credit: 1_000_000 },
        ],
      };
      expect(kinds([refund])).not.toContain("agent_commission");
    });
  });

  describe("round_trip", () => {
    it("flags cash-in followed by P2P straight back to the agent", () => {
      const findings = analyzeActivity([
        cashIn("t1", AGENT, CUSTOMER, 50_000),
        p2p("p1", CUSTOMER, AGENT, 50_000),
      ]);
      expect(findings).toEqual([
        expect.objectContaining({
          kind: "round_trip",
          account: AGENT,
          counterparty: CUSTOMER,
          amount: 50_000,
          entryIds: ["t1", "p1"],
        }),
      ]);
    });

    it("flags cash-in followed by a held cash-out at the same agent", () => {
      expect(
        kinds([cashIn("t1", AGENT, CUSTOMER, 50_000), cashOutSettle("c1", AGENT, CUSTOMER, 50_000)])
      ).toContain("round_trip");
    });

    it("ignores ordinary shopping at an agent-merchant under the minimum", () => {
      expect(
        kinds([cashIn("t1", AGENT, CUSTOMER, 2_000), shopPayment("q1", CUSTOMER, AGENT, 1_500)])
      ).not.toContain("round_trip");
    });

    it("ignores value that went back to a different agent", () => {
      expect(
        kinds([cashIn("t1", AGENT, CUSTOMER, 50_000), p2p("p1", CUSTOMER, AGENT_2, 50_000)])
      ).not.toContain("round_trip");
    });

    it("ignores a small share coming back", () => {
      expect(
        kinds([cashIn("t1", AGENT, CUSTOMER, 50_000), p2p("p1", CUSTOMER, AGENT, 20_000)])
      ).not.toContain("round_trip");
    });
  });

  describe("fees_net", () => {
    it("flags the platform paying out more commission than the floor allows", () => {
      // 26 × $250 cash-in → $130 commission, no fees in
      const entries = Array.from({ length: 26 }, (_, i) =>
        cashIn(`t${i}`, AGENT, `user:c${i}`, 25_000)
      );
      const finding = analyzeActivity(entries).find((f) => f.kind === "fees_net");
      expect(finding).toEqual(expect.objectContaining({ account: FEES, amount: -13_000 }));
    });

    it("is offset by fees taken", () => {
      const entries = [
        ...Array.from({ length: 26 }, (_, i) => cashIn(`t${i}`, AGENT, `user:c${i}`, 25_000)),
        shopPayment("q1", CUSTOMER, MERCHANT, 1_000_000), // +$100 in fees
      ];
      expect(kinds(entries)).not.toContain("fees_net");
    });
  });

  it("uses the thresholds it is given", () => {
    const entries = [cashIn("t1", AGENT, CUSTOMER, 10_000)];
    expect(
      analyzeActivity(entries, { ...DEFAULT_MONITOR_THRESHOLDS, agentCommissionDailyCents: 100 })
        .map((f) => f.kind)
    ).toContain("agent_commission");
  });
});

describe("runActivityMonitor", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  const { Timestamp } = admin.firestore;
  const posted = (entry: MonitoredEntry, msAgo: number) => ({
    type: entry.type,
    lines: entry.lines,
    postedAt: Timestamp.fromMillis(Date.now() - msAgo),
  });

  it("reads the last day only, and joins a held cash-out to its customer", async () => {
    const HOUR = 60 * 60 * 1000;
    const hold: MonitoredEntry = {
      id: "cashouthold_co1",
      type: "agent_cashout",
      lines: [
        { account: CUSTOMER, debit: 50_000, credit: 0 },
        { account: HOLD, debit: 0, credit: 50_000 },
      ],
    };
    const settle = cashOutSettle("cashout_co1", AGENT, CUSTOMER, 50_000);
    delete settle.customer; // stored entries don't carry it; the monitor joins it

    const db = fakeFirestore({
      "journal_entries/agenttopup_r1": posted(cashIn("agenttopup_r1", AGENT, CUSTOMER, 50_000), 3 * HOUR),
      "journal_entries/cashouthold_co1": posted(hold, 2 * HOUR),
      "journal_entries/cashout_co1": posted(settle, 1 * HOUR),
      // Outside the window: a self top-up two days ago is not today's finding.
      "journal_entries/manualtopup_old": posted(cashIn("old", AGENT, AGENT, 100_000), 48 * HOUR),
    });
    restore = useFakeFirestore(db);

    const report = await runActivityMonitor();
    expect(report.entryCount).toBe(3);
    expect(report.truncated).toBe(false);
    expect(report.findings.map((f) => f.kind)).toEqual(["round_trip"]);
    expect(report.findings[0]).toEqual(
      expect.objectContaining({ account: AGENT, counterparty: CUSTOMER })
    );
  });
});

describe("the nightly check carries the monitor's findings", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it("raises an alert for a self top-up even though the books balance", async () => {
    const { runInvariantCheck } = await import("../ledger/invariantCheck");
    const selfTopup = cashIn("manualtopup_x", AGENT, AGENT, 100_000);
    const db = fakeFirestore({
      "journal_entries/manualtopup_x": {
        type: selfTopup.type,
        lines: selfTopup.lines,
        postedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60_000),
      },
      // Projections that match the journal: no drift, nothing else to see.
      "wallets/agent-1": { balance: 2_000 },
      "ledger_balances/platform:fees": { balance: -2_000 },
    });
    restore = useFakeFirestore(db);

    const result = await runInvariantCheck({ trigger: "manual", triggeredBy: "test" });

    expect(result.drifts).toEqual([]);
    expect(result.activityFindingCount).toBe(1);
    const checkpoint = db.get(`ledger_checkpoints/${result.runId}`)!;
    expect(checkpoint.activityFindingCount).toBe(1);
    const alert = db.get(`ledger_alerts/${result.runId}`)!;
    expect(alert.acknowledged).toBe(false);
    expect(alert.activity).toEqual([
      expect.objectContaining({ kind: "self_dealing", account: AGENT, amount: 2_000 }),
    ]);
  });
});
