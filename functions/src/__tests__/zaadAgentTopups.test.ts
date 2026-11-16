import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
import { clearRatesCache, DEFAULT_RATES, RATE_FIELDS } from "../config/rates";
import {
  activeStrikes,
  creditEntry,
  holdEntry,
  maskMsisdn,
  normaliseTxnId,
  rankCandidates,
  releaseEntry,
  reversalEntry,
  splitReversal,
} from "../zaadAgent/core";
import { runZaadAgentSweep } from "../zaadAgent/sweep";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const mockedNotify = notifyUser as jest.MockedFunction<typeof notifyUser>;
const { Timestamp } = admin.firestore;

const AMINA = "cust-amina";
const HODAN = "agent-hodan";
const FARAH = "agent-farah";
const OPS = "ops-1";
const FLOAT = 10_000; // $100

const balance = (db: FakeDb, account: string) => db.get(`ledger_balances/${account}`)?.balance ?? 0;
const entries = (db: FakeDb) => [...db.store.keys()].filter((p) => p.startsWith("journal_entries/"));

describe("Zaad top-ups through agents: pure rules", () => {
  it("adds every setting to the console, switched off by default", () => {
    expect(DEFAULT_RATES.zaadAgentTopups).toBe("off");
    expect(DEFAULT_RATES.zaadAgentTopupCommissionRate).toBe(0.02);
    expect(DEFAULT_RATES.zaadAgentTopupMaxCents).toBe(10_000);
    expect(DEFAULT_RATES.zaadAgentDailyMaxCents).toBe(30_000);
    const keys = Object.keys(RATE_FIELDS).filter((k) => k.startsWith("zaadAgent"));
    expect(keys.length).toBe(15);
    for (const k of keys) expect(RATE_FIELDS[k as keyof typeof RATE_FIELDS].group).toBe("Zaad top-ups through agents");
  });

  it("every entry is zero-sum", () => {
    const sum = (e: { lines: { debit: number; credit: number }[] }) =>
      e.lines.reduce((s, l) => s + l.debit - l.credit, 0);
    expect(sum(holdEntry("r", "a", 1000))).toBe(0);
    expect(sum(creditEntry("r", "a", "c", 1000, 20, "t", "a"))).toBe(0);
    expect(sum(releaseEntry("r", "a", 1000, "expired", "system"))).toBe(0);
    expect(sum(reversalEntry("r", "a", "c", 300, 700, "ops"))).toBe(0);
  });

  it("repays a reversal from the customer first, the rest from Zapp", () => {
    expect(splitReversal(1000, 1500)).toEqual({ fromCustomer: 1000, fromZapp: 0 });
    expect(splitReversal(1000, 300)).toEqual({ fromCustomer: 300, fromZapp: 700 });
    expect(splitReversal(1000, 0)).toEqual({ fromCustomer: 0, fromZapp: 1000 });
  });

  it("offers the agent who has waited longest, and skips the unavailable", () => {
    const now = Date.now();
    const base = { enabled: true, online: true, receiveMsisdn: "+252634000001", openRequestId: null, lastSeenAt: Timestamp.fromMillis(now) };
    const ranked = rankCandidates(
      [
        { id: "recent", doc: { ...base, lastOfferedAt: Timestamp.fromMillis(now - 1000) } },
        { id: "waited", doc: { ...base, lastOfferedAt: Timestamp.fromMillis(now - 60_000) } },
        { id: "busy", doc: { ...base, openRequestId: "other" } },
        { id: "stale", doc: { ...base, lastSeenAt: Timestamp.fromMillis(now - 10 * 60_000) } },
        { id: "paused", doc: { ...base, pausedUntil: Timestamp.fromMillis(now + 60_000) } },
        { id: "unchecked", doc: { ...base, receiveMsisdn: null } },
        { id: "asked", doc: base },
        { id: "me", doc: base },
      ],
      { nowMs: now, customerId: "me", alreadyOffered: new Set(["asked"]) }
    );
    expect(ranked.map((c) => c.id)).toEqual(["waited", "recent"]);
  });

  it("masks numbers and cleans transaction IDs", () => {
    expect(maskMsisdn("+252634123456")).toBe("063 ••• 3456");
    expect(normaliseTxnId(" ab12 cd34 ")).toBe("AB12CD34");
    expect(normaliseTxnId("x")).toBeNull();
    expect(normaliseTxnId("bad/id")).toBeNull();
  });

  it("counts only strikes inside the window", () => {
    const now = Date.now();
    expect(activeStrikes([now - 1000, now - 40 * 86400_000], 30, now)).toBe(1);
  });
});

describe("Zaad top-ups through agents: the flow", () => {
  let fns: Record<string, any>;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const customer = await import("../zaadAgent/customer");
    const agent = await import("../zaadAgent/agent");
    const ops = await import("../zaadAgent/admin");
    fns = Object.fromEntries(
      Object.entries({ ...customer, ...agent, ...ops })
        .filter(([, v]) => typeof v === "function" && (v as any).__endpoint)
        .map(([k, v]) => [k, test.wrap(v)])
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPin.mockReset().mockResolvedValue(true);
    clearRatesCache();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const zaadAgent = (extra: Record<string, any> = {}) => ({
    receiveMsisdn: "+252634777001",
    enabled: true,
    online: true,
    lastSeenAt: Timestamp.now(),
    openRequestId: null,
    lastOfferedAt: null,
    missedOffers: 0,
    ...extra,
  });

  const seed = (opts: { rates?: Record<string, any>; extra?: Record<string, any>; farah?: boolean } = {}): FakeDb => {
    const db = fakeFirestore({
      "config/rates": { zaadAgentTopups: "on", ...opts.rates },
      [`users/${AMINA}`]: { accountType: "customer", fullName: "Amina Yusuf", kycStatus: "verified", phoneNumber: "+252634120987" },
      [`users/${HODAN}`]: { accountType: "topup_agent", fullName: "Hodan Ali", kycStatus: "verified", agentInfo: { businessName: "Hodan's Shop" } },
      [`wallets/${AMINA}`]: wallet(0),
      [`wallets/${HODAN}`]: wallet(0),
      [`ledger_balances/agent:${HODAN}`]: { account: `agent:${HODAN}`, balance: FLOAT, currency: "USD" },
      [`zaad_agents/${HODAN}`]: zaadAgent({ lastOfferedAt: Timestamp.fromMillis(Date.now() - 120_000) }),
      ...(opts.farah
        ? {
            [`users/${FARAH}`]: { accountType: "topup_agent", fullName: "Farah Omar", kycStatus: "verified" },
            [`wallets/${FARAH}`]: wallet(0),
            [`ledger_balances/agent:${FARAH}`]: { account: `agent:${FARAH}`, balance: FLOAT, currency: "USD" },
            [`zaad_agents/${FARAH}`]: zaadAgent({ receiveMsisdn: "+252634777002", lastOfferedAt: Timestamp.fromMillis(Date.now() - 60_000) }),
          }
        : {}),
      ...opts.extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const as = (uid: string, data: Record<string, unknown> = {}) => ({ data, auth: { uid, token: {} } });
  const asOps = (data: Record<string, unknown>) => ({
    data,
    auth: { uid: OPS, token: { admin: true, adminRoles: ["ops"], auth_time: Math.floor(Date.now() / 1000) - 10 } },
  });
  const req = (db: FakeDb, id: string) => db.get(`zaadAgentTopups/${id}`)!;

  /** Ask, accept and mark sent: the state just before the agent checks their Zaad. */
  async function toSent(db: FakeDb, amount = 1000, txn = "ZT12345") {
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount }));
    await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }));
    await fns.customerMarkZaadSent(as(AMINA, { requestId: data.requestId, zaadTxnId: txn }));
    return data.requestId as string;
  }

  it("is closed while the console switch is off", async () => {
    seed({ rates: { zaadAgentTopups: "off" } });
    await expect(fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }))).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("ask → accept → sent → received: the agent's float pays the customer, once", async () => {
    const db = seed();
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
    expect(data.status).toBe("offered");
    const id = data.requestId;
    expect(req(db, id).offeredTo).toBe(HODAN);
    expect(db.get(`zaad_agents/${HODAN}`)!.openRequestId).toBe(id);
    expect(mockedNotify).toHaveBeenCalledWith(HODAN, "zaad_agent_topup", expect.objectContaining({ key: "zaadAgent.offer" }), expect.anything());

    const accepted = await fns.agentAnswerZaadOffer(as(HODAN, { requestId: id, accept: true }));
    expect(accepted.data.allowedSenders).toEqual(["063 ••• 0987"]);
    expect(req(db, id)).toMatchObject({ status: "accepted", agentId: HODAN, dialCode: "*880*0634777001*10.00#" });
    expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT - 1000);
    expect(balance(db, "platform:zaad_agent_hold")).toBe(1000);

    await fns.customerMarkZaadSent(as(AMINA, { requestId: id, zaadTxnId: "zt 12345" }));
    expect(req(db, id)).toMatchObject({ status: "customer_sent", customerZaadTxnId: "ZT12345" });

    const done = await fns.agentConfirmZaadTopup(
      as(HODAN, { requestId: id, answer: "received", expectedAmount: 1000, agentPin: "123456" })
    );
    expect(done.data).toMatchObject({ status: "completed", commissionCents: 20 });
    expect(db.get(`wallets/${AMINA}`)!.balance).toBe(1000);
    expect(db.get(`wallets/${HODAN}`)!.balance).toBe(20);
    expect(balance(db, "platform:zaad_agent_hold")).toBe(0);
    expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT - 1000);
    expect(db.get(`zaad_agents/${HODAN}`)!.openRequestId).toBeNull();
    expect(db.get(`transactions/zaadagent_${id}`)).toMatchObject({ kind: "cash_in", participants: [HODAN, AMINA] });

    // A second confirm (a retry) credits nothing more.
    await fns.agentConfirmZaadTopup(as(HODAN, { requestId: id, answer: "received", expectedAmount: 1000, agentPin: "123456" }));
    expect(db.get(`wallets/${AMINA}`)!.balance).toBe(1000);
    expect(entries(db)).toHaveLength(2);
  });

  it("refuses a confirm for a different amount, or with a wrong PIN", async () => {
    const db = seed();
    const id = await toSent(db);
    await expect(
      fns.agentConfirmZaadTopup(as(HODAN, { requestId: id, answer: "received", expectedAmount: 5000, agentPin: "1" }))
    ).rejects.toMatchObject({ details: { reason: "amount_mismatch" } });
    mockedPin.mockResolvedValue(false);
    await expect(
      fns.agentConfirmZaadTopup(as(HODAN, { requestId: id, answer: "received", expectedAmount: 1000, agentPin: "1" }))
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(db.get(`wallets/${AMINA}`)!.balance).toBe(0);
  });

  it("only the agent who accepted can confirm", async () => {
    const db = seed({ farah: true });
    const id = await toSent(db);
    await expect(
      fns.agentConfirmZaadTopup(as(FARAH, { requestId: id, answer: "received", expectedAmount: 1000, agentPin: "1" }))
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("a Zaad transaction ID claims one request only", async () => {
    const db = seed();
    const first = await toSent(db, 1000, "ZT999");
    await fns.agentConfirmZaadTopup(as(HODAN, { requestId: first, answer: "received", expectedAmount: 1000, agentPin: "1" }));
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 500 }));
    await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }));
    await expect(
      fns.customerMarkZaadSent(as(AMINA, { requestId: data.requestId, zaadTxnId: "zt999" }))
    ).rejects.toMatchObject({ details: { reason: "txn_id_used" } });
  });

  it("one request at a time, and agents can't top themselves up", async () => {
    seed();
    await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
    await expect(fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }))).rejects.toMatchObject({
      details: { reason: "in_progress" },
    });
    await expect(fns.customerRequestZaadAgentTopup(as(HODAN, { amount: 1000 }))).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("keeps to the console's limits", async () => {
    seed({ rates: { zaadAgentTopupMaxCents: 5000, zaadAgentDailyCount: 1 } });
    await expect(fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 6000 }))).rejects.toMatchObject({
      details: { reason: "amount_out_of_range" },
    });
    await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
    await expect(fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }))).rejects.toMatchObject({
      details: { reason: "daily_count" },
    });
  });

  it("skips an agent without enough float, and says when nobody is free", async () => {
    const db = seed({ extra: { [`ledger_balances/agent:${HODAN}`]: { account: `agent:${HODAN}`, balance: 500, currency: "USD" } } });
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
    expect(data.status).toBe("no_agent");
    expect(db.get(`zaad_agents/${HODAN}`)!.openRequestId).toBeNull();
    expect(mockedNotify).toHaveBeenCalledWith(AMINA, "zaad_agent_topup", expect.objectContaining({ key: "zaadAgent.no_agent" }), expect.anything());
  });

  it("a decline passes the request to the next agent", async () => {
    const db = seed({ farah: true });
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
    // Hodan waited longer since his last offer, so he's first.
    expect(req(db, data.requestId).offeredTo).toBe(HODAN);
    await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: false }));
    expect(req(db, data.requestId).offeredTo).toBe(FARAH);
    expect(db.get(`zaad_agents/${HODAN}`)!.openRequestId).toBeNull();
    // Hodan can no longer accept it.
    await expect(fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }))).rejects.toMatchObject({
      details: { reason: "offer_ended" },
    });
  });

  it("an unanswered offer moves on, and two in a row take the agent offline", async () => {
    const db = seed({ farah: true });
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
    await runZaadAgentSweep(Date.now() + 60_000);
    expect(req(db, data.requestId).offeredTo).toBe(FARAH);
    expect(db.get(`zaad_agents/${HODAN}`)!.missedOffers).toBe(1);
    expect(db.get(`zaad_agents/${HODAN}`)!.online).toBe(true);

    await db.doc(`zaad_agents/${HODAN}`).update({ missedOffers: 1 });
    await db.doc(`zaad_agents/${FARAH}`).update({ missedOffers: 1 });
    await runZaadAgentSweep(Date.now() + 120_000);
    expect(db.get(`zaad_agents/${FARAH}`)!.online).toBe(false);
  });

  it("returns the float when the customer doesn't send in time", async () => {
    const db = seed();
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
    await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }));
    await runZaadAgentSweep(Date.now() + 11 * 60_000);
    expect(req(db, data.requestId).status).toBe("expired");
    expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT);
    expect(balance(db, "platform:zaad_agent_hold")).toBe(0);
    await expect(
      fns.customerMarkZaadSent(as(AMINA, { requestId: data.requestId, zaadTxnId: "ZT777" }))
    ).rejects.toMatchObject({ details: { reason: "wrong_status" } });
  });

  it("the customer can cancel before sending, and the float comes back", async () => {
    const db = seed();
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
    await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }));
    await fns.customerCancelZaadTopup(as(AMINA, { requestId: data.requestId }));
    expect(req(db, data.requestId).status).toBe("cancelled");
    expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT);
    expect(db.get(`zaad_agents/${HODAN}`)!.openRequestId).toBeNull();
  });

  it("an agent who doesn't answer turns it into a dispute, and the money stays held", async () => {
    const db = seed();
    const id = await toSent(db);
    await runZaadAgentSweep(Date.now() + 16 * 60_000);
    expect(req(db, id)).toMatchObject({ status: "disputed", disputedBy: "timeout" });
    expect(balance(db, "platform:zaad_agent_hold")).toBe(1000);
    expect(db.get(`zaad_agents/${HODAN}`)!.online).toBe(false);
  });

  it("not received → dispute → ops decide for the customer: credited from the hold, no commission", async () => {
    const db = seed();
    const id = await toSent(db);
    await fns.agentConfirmZaadTopup(as(HODAN, { requestId: id, answer: "not_received", expectedAmount: 1000 }));
    expect(req(db, id).status).toBe("declined");
    expect(balance(db, "platform:zaad_agent_hold")).toBe(1000);
    await fns.customerDisputeZaadTopup(as(AMINA, { requestId: id, reason: "I sent it, ID ZT12345" }));
    expect(req(db, id).status).toBe("disputed");

    await fns.adminResolveZaadTopup(asOps({ requestId: id, outcome: "customer", reason: "Telesom statement shows it" }));
    expect(req(db, id)).toMatchObject({ status: "completed", commissionCents: 0, resolution: { outcome: "customer" } });
    expect(db.get(`wallets/${AMINA}`)!.balance).toBe(1000);
    expect(db.get(`wallets/${HODAN}`)!.balance).toBe(0);
    expect(balance(db, "platform:zaad_agent_hold")).toBe(0);
    expect([...db.store.keys()].some((p) => p.startsWith("admin_audit/"))).toBe(true);
  });

  it("ops deciding for the agent returns the float and strikes the customer; strikes block", async () => {
    const db = seed({ rates: { zaadAgentCustomerStrikes: 1 } });
    const id = await toSent(db);
    await fns.agentConfirmZaadTopup(as(HODAN, { requestId: id, answer: "not_received", expectedAmount: 1000 }));
    await fns.customerDisputeZaadTopup(as(AMINA, { requestId: id }));
    await fns.adminResolveZaadTopup(asOps({ requestId: id, outcome: "agent", reason: "No payment on the agent's statement" }));
    expect(req(db, id).status).toBe("released");
    expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT);
    expect(db.get(`zaad_agent_customers/${AMINA}`)!.strikes).toHaveLength(1);
    await expect(fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }))).rejects.toMatchObject({
      details: { reason: "blocked" },
    });
  });

  it("an undisputed decline releases the float when the window passes", async () => {
    const db = seed();
    const id = await toSent(db);
    await fns.agentConfirmZaadTopup(as(HODAN, { requestId: id, answer: "different_amount", expectedAmount: 1000 }));
    await runZaadAgentSweep(Date.now() + 61 * 60_000);
    expect(req(db, id).status).toBe("released");
    expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT);
  });

  it("a confirmed reversal repays the agent: customer's wallet first, then Zapp", async () => {
    const db = seed();
    const id = await toSent(db);
    await fns.agentConfirmZaadTopup(as(HODAN, { requestId: id, answer: "received", expectedAmount: 1000, agentPin: "1" }));
    // Amina spent $7 of the $10 before Telesom reversed her payment.
    await db.doc(`wallets/${AMINA}`).update({ balance: 300 });
    await db.doc(`ledger_balances/user:${AMINA}`).set({ account: `user:${AMINA}`, balance: 300, currency: "USD" });

    await fns.agentReportZaadReversal(as(HODAN, { requestId: id, note: "Telesom reversed it" }));
    const res = await fns.adminDecideZaadReversal(asOps({ requestId: id, confirm: true, reason: "Confirmed with Telesom" }));
    expect(res.data).toEqual({ fromCustomerCents: 300, fromZappCents: 700 });
    expect(db.get(`wallets/${AMINA}`)!.balance).toBe(0);
    expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT);
    // Balances read credit minus debit, so Zapp's loss shows as negative.
    expect(balance(db, "platform:zaad_reversal_losses")).toBe(-700);
    expect(db.get(`zaad_agent_customers/${AMINA}`)).toMatchObject({ blocked: true, blockedReason: "reversal" });
    await expect(
      fns.adminDecideZaadReversal(asOps({ requestId: id, confirm: true, reason: "Confirmed with Telesom" }))
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("lists what ops need: disputes with names, held money, and agents", async () => {
    const db = seed();
    const id = await toSent(db);
    await runZaadAgentSweep(Date.now() + 16 * 60_000);
    const res = await fns.adminListZaadTopups(asOps({ view: "attention" }));
    expect(res.data.heldCents).toBe(1000);
    expect(res.data.topups).toHaveLength(1);
    expect(res.data.topups[0]).toMatchObject({
      id,
      status: "disputed",
      customerName: "Amina Yusuf",
      customerPhone: "063 412 0987",
      agentName: "Hodan's Shop",
      agentReceiveNumber: "063 477 7001",
      customerZaadTxnId: "ZT12345",
      disputedBy: "timeout",
    });
    const open = await fns.adminListZaadTopups(asOps({ view: "open" }));
    expect(open.data.topups).toHaveLength(0);
    const agents = await fns.adminListZaadAgents(asOps({}));
    expect(agents.data.agents[0]).toMatchObject({ id: HODAN, receiveNumber: "063 477 7001", floatCents: FLOAT - 1000, enabled: true });
    // Customers and agents can't call it.
    await expect(fns.adminListZaadTopups(as(AMINA, { view: "attention" }))).rejects.toThrow();
  });

  it("ops record an agent's number; a change pauses them", async () => {
    const db = seed({ extra: { [`zaad_agents/${HODAN}`]: undefined } });
    db.store.delete(`zaad_agents/${HODAN}`);
    await fns.adminSetZaadAgent(asOps({ agentId: HODAN, receiveMsisdn: "063 477 7001", enabled: true, reason: "Checked in person at the office" }));
    expect(db.get(`zaad_agents/${HODAN}`)).toMatchObject({ receiveMsisdn: "+252634777001", enabled: true, pausedUntil: null });
    const changed = await fns.adminSetZaadAgent(
      asOps({ agentId: HODAN, receiveMsisdn: "063 477 7999", enabled: true, reason: "New SIM, checked in person" })
    );
    expect(changed.data.pausedUntil).not.toBeNull();
    await expect(fns.agentSetZaadOnline(as(HODAN, { online: true }))).rejects.toMatchObject({ details: { reason: "paused" } });
    await expect(
      fns.adminSetZaadAgent(asOps({ agentId: AMINA, receiveMsisdn: "063 477 7000", enabled: true, reason: "Not an agent at all" }))
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
