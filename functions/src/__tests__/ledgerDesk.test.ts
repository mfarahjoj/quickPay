import * as admin from "firebase-admin";

const test = require("firebase-functions-test")();

/**
 * Ledger desk coverage.
 *
 * Guards: everything here rejects before Firestore is touched (the read and
 * write paths need the emulator suite, blocked on Java in this environment).
 * Trace logic: the pure helpers that decide whether a transaction made it
 * into the journal, which is what the console shows an operator.
 */
const freshAuth = (roles: string[], uid = "admin-1") => ({
  uid,
  token: {
    email: "ops@zapp.example",
    admin: true,
    adminRoles: roles,
    auth_time: Math.floor(Date.now() / 1000) - 30,
  },
});

let mod: typeof import("../admin/ledgerDesk");

beforeAll(async () => {
  if (!admin.apps.length) admin.initializeApp();
  mod = await import("../admin/ledgerDesk");
});

afterAll(() => test.cleanup());

describe("ledger desk guards", () => {
  const callables = () => ({
    overview: test.wrap(mod.adminGetLedgerOverview),
    alert: test.wrap(mod.adminGetLedgerAlert),
    trace: test.wrap(mod.adminTraceLedgerAccount),
    acknowledge: test.wrap(mod.adminAcknowledgeLedgerAlert),
    run: test.wrap(mod.adminRunLedgerCheck),
  });

  it("rejects unauthenticated callers on every callable", async () => {
    for (const fn of Object.values(callables())) {
      await expect(fn({ data: {} })).rejects.toThrow();
    }
  });

  it("rejects a signed-in non-admin", async () => {
    for (const fn of Object.values(callables())) {
      await expect(fn({ data: {}, auth: { uid: "u1", token: {} } })).rejects.toThrow(
        /not authorized/i
      );
    }
  });

  it("rejects a compliance-only admin", async () => {
    // Reconciliation sits with ops, like the float and payout desks.
    for (const fn of Object.values(callables())) {
      await expect(fn({ data: {}, auth: freshAuth(["compliance"]) })).rejects.toThrow(
        /not authorized/i
      );
    }
  });

  it("requires an alert id to open or acknowledge an alert", async () => {
    const { alert, acknowledge } = callables();
    await expect(alert({ data: {}, auth: freshAuth(["ops"]) })).rejects.toThrow(/alertId/);
    await expect(
      acknowledge({
        data: { reason: "drift traced to ticket 4821" },
        auth: freshAuth(["ops"]),
      })
    ).rejects.toThrow(/alertId/);
  });

  it("rejects alert ids that would escape the collection", async () => {
    const { alert } = callables();
    await expect(
      alert({ data: { alertId: "x/../../users/u1" }, auth: freshAuth(["ops"]) })
    ).rejects.toThrow(/alertId/);
  });

  it("requires a reason to acknowledge or re-run", async () => {
    const { acknowledge, run } = callables();
    await expect(
      acknowledge({ data: { alertId: "2026-10-02-00-00-10", reason: "ok" }, auth: freshAuth(["ops"]) })
    ).rejects.toThrow(/reason/i);
    await expect(run({ data: { reason: "" }, auth: freshAuth(["super"]) })).rejects.toThrow(
      /reason/i
    );
  });

  it("only traces customer wallets", async () => {
    const { trace } = callables();
    for (const account of ["platform:fees", "float:agents", "user:", "users/abc", 42]) {
      await expect(trace({ data: { account }, auth: freshAuth(["ops"]) })).rejects.toThrow(
        /customer wallets/i
      );
    }
  });
});

describe("trace helpers", () => {
  const account = "user:u1";
  const entry = (lines: { account: string; debit: number; credit: number }[]) => ({
    type: "p2p" as const,
    lines,
  });

  it("nets credits and debits for the traced account only", () => {
    const e = entry([
      { account: "user:u1", debit: 0, credit: 1000 },
      { account: "user:u2", debit: 1050, credit: 0 },
      { account: "platform:fees", debit: 0, credit: 50 },
    ]);
    expect(mod.walletEffect(e, "user:u1")).toBe(1000);
    expect(mod.walletEffect(e, "user:u2")).toBe(-1050);
    expect(mod.walletEffect(e, "user:nobody")).toBe(0);
  });

  it("classifies a transaction against the journal", () => {
    const entries = new Map([["p2p_tx1", entry([{ account, debit: 0, credit: 1000 }])]]);

    const posted = mod.traceTransaction(
      "tx1",
      { journalEntryId: "p2p_tx1", status: "completed", amount: 1000, toUserId: "u1" },
      entries,
      account
    );
    expect(posted).toMatchObject({ link: "posted", walletEffect: 1000, direction: "in" });

    const noId = mod.traceTransaction(
      "tx2",
      { status: "completed", amount: 500, fromUserId: "u1" },
      entries,
      account
    );
    expect(noId).toMatchObject({ link: "no-entry-id", walletEffect: null, direction: "out" });

    const dangling = mod.traceTransaction(
      "tx3",
      { journalEntryId: "p2p_gone", status: "completed", amount: 700 },
      entries,
      account
    );
    expect(dangling).toMatchObject({ link: "entry-missing", walletEffect: null, direction: null });
  });

  it("counts only settled transactions that skipped the journal", () => {
    const rows = [
      { status: "completed", link: "posted", amount: 1000 },
      { status: "completed", link: "no-entry-id", amount: 500 },
      { status: "success", link: "entry-missing", amount: 250 },
      // Pending and failed transactions are expected to have no entry.
      { status: "pending", link: "no-entry-id", amount: 9999 },
      { status: "failed", link: "no-entry-id", amount: 9999 },
    ].map((r, i) =>
      mod.traceTransaction(
        `tx${i}`,
        { status: r.status, amount: r.amount, ...(r.link === "posted" ? { journalEntryId: "e" } : {}),
          ...(r.link === "entry-missing" ? { journalEntryId: "missing" } : {}) },
        new Map([["e", entry([{ account, debit: 0, credit: 1000 }])]]),
        account
      )
    );

    expect(mod.summarizeTrace(rows)).toEqual({
      completed: 3,
      completedUnposted: 2,
      completedUnpostedAmount: 750,
    });
  });

  it("turns NaN and non-numbers into null so they survive JSON", () => {
    expect(mod.finiteOrNull(NaN)).toBeNull();
    expect(mod.finiteOrNull(undefined)).toBeNull();
    expect(mod.finiteOrNull("12")).toBeNull();
    expect(mod.finiteOrNull(-250)).toBe(-250);
  });
});
