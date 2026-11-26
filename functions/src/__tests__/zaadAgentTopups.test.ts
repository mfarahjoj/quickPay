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
  isTopupReference,
  maskMsisdn,
  newTopupReference,
  normaliseTxnId,
  rankCandidates,
  releaseEntry,
  reversalEntry,
  splitReversal,
} from "../zaadAgent/core";
import { runZaadAgentSweep } from "../zaadAgent/sweep";
import * as fs from "fs";
import * as path from "path";
import * as core from "../zaadAgent/core";

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
    expect(keys.length).toBe(16);
    expect(DEFAULT_RATES.zaadAgentMaxOpenRequests).toBe(3);
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

  it("D31: references are short, read aloud cleanly, and have no look-alike characters", () => {
    for (let i = 0; i < 500; i++) {
      const r = newTopupReference();
      expect(isTopupReference(r)).toBe(true);
      expect(r).toMatch(/^ZP-[^01ILOSBZUV258]{5}$/);
    }
    expect(newTopupReference(() => 0)).toBe("ZP-33333");
    expect(isTopupReference("ZP-0O1IL")).toBe(false);
    expect(isTopupReference("zp-4f7k2")).toBe(false);
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

  /** The same with today's apps: "I've sent it" with no ID. */
  async function toSentNoId(amount = 1000) {
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount }));
    await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }));
    await fns.customerMarkZaadSent(as(AMINA, { requestId: data.requestId }));
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

  describe("D32: several requests per agent, stored, with a push for each", () => {
    const CUSTOMERS = ["cust-2", "cust-3", "cust-4"];
    const customers = Object.fromEntries(
      CUSTOMERS.flatMap((uid, i) => [
        [`users/${uid}`, { accountType: "customer", fullName: `Customer ${i + 2}`, kycStatus: "verified", phoneNumber: `+25263412000${i}` }],
        [`wallets/${uid}`, wallet(0)],
      ])
    );
    const ask = async (uid: string, amount = 1000) =>
      (await fns.customerRequestZaadAgentTopup(as(uid, { amount }))).data as { requestId: string; status: string };
    const pushes = (key: string, to?: string) =>
      mockedNotify.mock.calls.filter(([uid, , msg]) => (msg as any).key === key && (!to || uid === to)).length;

    it("one agent takes up to the cap (3 by default); the next request finds nobody", async () => {
      const db = seed({ extra: customers });
      const a = await ask(AMINA);
      const b = await ask("cust-2");
      const c = await ask("cust-3");
      expect([a.status, b.status, c.status]).toEqual(["offered", "offered", "offered"]);
      expect(db.get(`zaad_agents/${HODAN}`)).toMatchObject({
        openRequestIds: [a.requestId, b.requestId, c.requestId],
        openRequestId: c.requestId, // the newest, for merchant builds ≤ 31
      });
      expect((await ask("cust-4")).status).toBe("no_agent");
      // Each offer pushed once, with the seconds to answer.
      expect(pushes("zaadAgent.offer", HODAN)).toBe(3);
      expect(mockedNotify).toHaveBeenCalledWith(
        HODAN,
        "zaad_agent_topup",
        { key: "zaadAgent.offer", params: { amount: expect.any(String), earn: expect.any(String), seconds: "60" } },
        expect.objectContaining({ type: "zaad_agent_offer", requestId: a.requestId, expiresAt: expect.any(String) })
      );

      // Finishing one frees a place.
      await fns.agentAnswerZaadOffer(as(HODAN, { requestId: a.requestId, accept: true }));
      await fns.customerMarkZaadSent(as(AMINA, { requestId: a.requestId }));
      await fns.agentConfirmZaadTopup(as(HODAN, { requestId: a.requestId, answer: "received", expectedAmount: 1000, agentPin: "1" }));
      expect(db.get(`zaad_agents/${HODAN}`)!.openRequestIds).toEqual([b.requestId, c.requestId]);
      // cust-4's request ended no_agent, so they may ask again.
      expect((await ask("cust-4")).status).toBe("offered");
    });

    it("the console's cap is obeyed", async () => {
      seed({ extra: customers, rates: { zaadAgentMaxOpenRequests: 1 } });
      expect((await ask(AMINA)).status).toBe("offered");
      expect((await ask("cust-2")).status).toBe("no_agent");
    });

    it("free float counts what is ringing and what is held", async () => {
      const db = seed({ extra: customers }); // $100 float
      const a = await ask(AMINA, 6000);
      // $60 is promised to the ringing offer: $50 more doesn't fit.
      expect((await ask("cust-2", 5000)).status).toBe("no_agent");
      await fns.agentAnswerZaadOffer(as(HODAN, { requestId: a.requestId, accept: true }));
      expect(balance(db, `agent:${HODAN}`)).toBe(4000);
      // Held now: still $40 free.
      expect((await ask("cust-3", 5000)).status).toBe("no_agent");
      expect((await ask("cust-4", 4000)).status).toBe("offered");
    });

    it("cancel, decline and timeout each free only their own place", async () => {
      const db = seed({ extra: customers });
      const a = await ask(AMINA);
      const b = await ask("cust-2");
      await fns.customerCancelZaadTopup(as(AMINA, { requestId: a.requestId }));
      expect(db.get(`zaad_agents/${HODAN}`)).toMatchObject({ openRequestIds: [b.requestId], openRequestId: b.requestId });
      await fns.agentAnswerZaadOffer(as(HODAN, { requestId: b.requestId, accept: false }));
      expect(db.get(`zaad_agents/${HODAN}`)).toMatchObject({ openRequestIds: [], openRequestId: null });
    });

    it("reads an agent doc written before D32", async () => {
      const db = seed({ extra: { ...customers, [`zaad_agents/${HODAN}`]: zaadAgent({ openRequestId: "older" }) } });
      const a = await ask(AMINA);
      expect(db.get(`zaad_agents/${HODAN}`)!.openRequestIds).toEqual(["older", a.requestId]);
    });

    it("5 minutes before review the agent is reminded once, then told once when it goes to review", async () => {
      const db = seed();
      const id = await toSentNoId();
      const confirmBy = req(db, id).confirmBy.toMillis();
      expect(req(db, id).deadlineAt.toMillis()).toBe(confirmBy - 5 * 60_000);

      await runZaadAgentSweep(confirmBy - 6 * 60_000);
      expect(pushes("zaadAgent.confirm_reminder")).toBe(0);
      await runZaadAgentSweep(confirmBy - 4 * 60_000);
      await runZaadAgentSweep(confirmBy - 3 * 60_000);
      expect(pushes("zaadAgent.confirm_reminder", HODAN)).toBe(1);
      expect(req(db, id).deadlineAt.toMillis()).toBe(confirmBy);

      await runZaadAgentSweep(confirmBy + 1000);
      await runZaadAgentSweep(confirmBy + 2000);
      expect(req(db, id).status).toBe("disputed");
      expect(pushes("zaadAgent.disputed", HODAN)).toBe(1);
      expect(db.get(`zaad_agents/${HODAN}`)!.openRequestIds).toEqual([]);
    });

    it("the agent hears ops' ruling, either way", async () => {
      seed({ extra: customers });
      const a = await toSentNoId();
      await fns.agentConfirmZaadTopup(as(HODAN, { requestId: a, answer: "not_received", expectedAmount: 1000 }));
      await fns.customerDisputeZaadTopup(as(AMINA, { requestId: a }));
      await fns.adminResolveZaadTopup(asOps({ requestId: a, outcome: "customer", reason: "Statement shows it" }));
      expect(pushes("zaadAgent.ruling_for_customer", HODAN)).toBe(1);

      const { requestId: b } = await ask("cust-2");
      await fns.agentAnswerZaadOffer(as(HODAN, { requestId: b, accept: true }));
      await fns.customerMarkZaadSent(as("cust-2", { requestId: b }));
      await fns.agentConfirmZaadTopup(as(HODAN, { requestId: b, answer: "not_received", expectedAmount: 1000 }));
      await fns.customerDisputeZaadTopup(as("cust-2", { requestId: b }));
      await fns.adminResolveZaadTopup(asOps({ requestId: b, outcome: "agent", reason: "Nothing on the statement" }));
      expect(pushes("zaadAgent.ruling_for_agent", HODAN)).toBe(1);
      expect(pushes("zaadAgent.float_returned", HODAN)).toBe(0);
    });

    it("the status call reports open requests against the cap", async () => {
      seed({ extra: customers });
      await ask(AMINA);
      const status = await fns.agentGetZaadStatus(as(HODAN));
      expect(status.data).toMatchObject({ openCount: 1, maxOpen: 3 });
    });

    it("rules: only the request's customer, its agent, or the agent it rings on can read it; nobody writes", () => {
      // No rules emulator in this suite: check the rule as written.
      const rules = fs.readFileSync(path.join(__dirname, "../../../firestore.rules"), "utf8");
      const block = rules.slice(rules.indexOf("match /zaadAgentTopups/{requestId}"));
      const body = block.slice(0, block.indexOf("allow write") + "allow write: if false;".length).replace(/\s+/g, " ");
      expect(body).toContain(
        "allow read: if isAuthenticated() && (isOwner(resource.data.customerId) || isOwner(resource.data.agentId) || isOwner(resource.data.offeredTo) || request.auth.uid in resource.data.offeredToIds);"
      );
      expect(body).toContain("allow write: if false;");
      const indexes = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../firestore.indexes.json"), "utf8"));
      expect(indexes.indexes).toContainEqual(
        expect.objectContaining({
          collectionGroup: "zaadAgentTopups",
          fields: [
            { fieldPath: "agentId", order: "ASCENDING" },
            { fieldPath: "createdAt", order: "DESCENDING" },
          ],
        })
      );
    });
  });

  describe("D31: Zapp's reference, and Zaad's ID from the agent", () => {
    it("each request gets a claimed reference; the customer taps once and types nothing", async () => {
      const db = seed();
      const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
      expect(isTopupReference(data.reference)).toBe(true);
      expect(req(db, data.requestId).reference).toBe(data.reference);
      expect(db.get(`zaad_agent_refs/${data.reference}`)).toMatchObject({ requestId: data.requestId, customerId: AMINA });

      const accepted = await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }));
      expect(accepted.data.reference).toBe(data.reference);

      await fns.customerMarkZaadSent(as(AMINA, { requestId: data.requestId }));
      expect(req(db, data.requestId)).toMatchObject({ status: "customer_sent" });
      expect(req(db, data.requestId).customerZaadTxnId).toBeUndefined();
      // The same tap again is a retry, not an error.
      await fns.customerMarkZaadSent(as(AMINA, { requestId: data.requestId }));

      await fns.agentConfirmZaadTopup(as(HODAN, { requestId: data.requestId, answer: "received", expectedAmount: 1000, agentPin: "1" }));
      expect(db.get(`wallets/${AMINA}`)!.balance).toBe(1000);
      expect(db.get(`transactions/zaadagent_${data.requestId}`)!.reference).toBe(data.reference);
      expect(db.get(`manualTopups/zaadagent_${data.requestId}`)!.reference).toBe(data.reference);
      const rows = await fns.adminListZaadTopups(asOps({ view: "recent" }));
      expect(rows.data.topups).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: data.requestId, reference: data.reference })])
      );
    });

    it("never reuses a reference that is already taken", async () => {
      const db = seed({ extra: { "zaad_agent_refs/ZP-34679": { requestId: "older", customerId: "someone" } } });
      const spy = jest.spyOn(core, "newTopupReference").mockReturnValueOnce("ZP-34679").mockReturnValueOnce("ZP-ACDEF");
      try {
        const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
        expect(data.reference).toBe("ZP-ACDEF");
        expect(db.get("zaad_agent_refs/ZP-34679")!.requestId).toBe("older");
      } finally {
        spy.mockRestore();
      }
    });

    it("the agent may give Zaad's ID on Received; it claims that payment for one top-up only", async () => {
      const db = seed();
      const first = await toSentNoId();
      await fns.agentConfirmZaadTopup(
        as(HODAN, { requestId: first, answer: "received", expectedAmount: 1000, agentPin: "1", zaadTxnId: "zt 777" })
      );
      expect(req(db, first)).toMatchObject({ status: "completed", agentZaadTxnId: "ZT777" });
      expect(db.get("zaad_agent_txn_ids/ZT777")).toMatchObject({ requestId: first, by: "agent" });
      expect(db.get(`transactions/zaadagent_${first}`)!.zaadTxnId).toBe("ZT777");

      const second = await toSentNoId(500);
      await expect(
        fns.agentConfirmZaadTopup(
          as(HODAN, { requestId: second, answer: "received", expectedAmount: 500, agentPin: "1", zaadTxnId: "ZT777" })
        )
      ).rejects.toMatchObject({ details: { reason: "txn_id_used" } });
      expect(req(db, second).status).toBe("customer_sent");
      expect(db.get(`wallets/${AMINA}`)!.balance).toBe(1000);

      await expect(
        fns.agentConfirmZaadTopup(
          as(HODAN, { requestId: second, answer: "received", expectedAmount: 500, agentPin: "1", zaadTxnId: "no/good" })
        )
      ).rejects.toMatchObject({ details: { reason: "txn_id" } });
      // Without an ID it goes through.
      await fns.agentConfirmZaadTopup(as(HODAN, { requestId: second, answer: "received", expectedAmount: 500, agentPin: "1" }));
      expect(db.get(`wallets/${AMINA}`)!.balance).toBe(1500);
    });

    it("old builds (82–83) still send the customer's ID: accepted, claimed, and the agent may repeat it", async () => {
      const db = seed();
      const id = await toSent(db, 1000, "ZT4242");
      expect(req(db, id).customerZaadTxnId).toBe("ZT4242");
      expect(db.get("zaad_agent_txn_ids/ZT4242")).toMatchObject({ requestId: id, customerId: AMINA });
      // Their retry with the same ID is still fine.
      await fns.customerMarkZaadSent(as(AMINA, { requestId: id, zaadTxnId: "ZT4242" }));
      await fns.agentConfirmZaadTopup(
        as(HODAN, { requestId: id, answer: "received", expectedAmount: 1000, agentPin: "1", zaadTxnId: "ZT4242" })
      );
      expect(req(db, id).status).toBe("completed");
      expect(db.get(`transactions/zaadagent_${id}`)).toMatchObject({ reference: req(db, id).reference, zaadTxnId: "ZT4242" });
    });
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

  describe("a job: rung on every free agent at once, first to accept wins", () => {
    const pushes = (key: string, to?: string) =>
      mockedNotify.mock.calls.filter(([uid, , msg]) => (msg as any).key === key && (!to || uid === to)).length;

    it("rings every available agent at once, with one shared deadline and what they'd earn", async () => {
      const db = seed({ farah: true });
      const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
      const r = req(db, data.requestId);
      expect(r.status).toBe("offered");
      expect([...r.offeredToIds].sort()).toEqual([FARAH, HODAN].sort());
      expect(r.offeredTo).toBe(HODAN); // longest-waiting first, for older merchant builds
      expect(r.offers).toHaveLength(2);
      expect(r.offers[0].expiresAt.toMillis()).toBe(r.offers[1].expiresAt.toMillis());
      expect(r.offerExpiresAt.toMillis() - r.createdAt.toMillis()).toBe(60_000);
      expect(r.agentCommissionCents).toBeGreaterThanOrEqual(0);
      expect(pushes("zaadAgent.offer", HODAN)).toBe(1);
      expect(pushes("zaadAgent.offer", FARAH)).toBe(1);
      expect(db.get(`zaad_agents/${HODAN}`)!.openRequestIds).toEqual([data.requestId]);
      expect(db.get(`zaad_agents/${FARAH}`)!.openRequestIds).toEqual([data.requestId]);
    });

    it("rings only as many agents as the console says", async () => {
      const db = seed({ farah: true, rates: { zaadAgentOffersPerRequest: 1 } });
      const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
      expect(req(db, data.requestId).offeredToIds).toEqual([HODAN]);
      expect(db.get(`zaad_agents/${FARAH}`)!.openRequestIds).toBeUndefined();
    });

    it("the first to accept wins: float held once, the other agent is freed and can't accept", async () => {
      const db = seed({ farah: true });
      const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
      await fns.agentAnswerZaadOffer(as(FARAH, { requestId: data.requestId, accept: true }));
      const r = req(db, data.requestId);
      expect(r).toMatchObject({ status: "accepted", agentId: FARAH, offeredToIds: [], offeredTo: null });
      expect(r.offers.map((o: any) => [o.agentId, o.answer]).sort()).toEqual([[FARAH, "accepted"], [HODAN, "taken"]].sort());
      expect(balance(db, `agent:${FARAH}`)).toBe(FLOAT - 1000);
      expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT);
      expect(db.get(`zaad_agents/${HODAN}`)!.openRequestIds).toEqual([]);
      expect(db.get(`zaad_agents/${FARAH}`)!.openRequestIds).toEqual([data.requestId]);
      await expect(fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }))).rejects.toMatchObject({
        details: { reason: "offer_ended" },
      });
      // The winner asking again (a double tap or a retry) gets the same answer, and the float is held once.
      const again = await fns.agentAnswerZaadOffer(as(FARAH, { requestId: data.requestId, accept: true }));
      expect(again.data).toMatchObject({ requestId: data.requestId, amount: 1000 });
      expect(balance(db, `agent:${FARAH}`)).toBe(FLOAT - 1000);
      expect(pushes("zaadAgent.accepted", AMINA)).toBe(1);
    });

    it("a decline leaves the others ringing; the last decline tells the customer at once", async () => {
      const db = seed({ farah: true });
      const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
      await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: false }));
      expect(req(db, data.requestId)).toMatchObject({ status: "offered", offeredToIds: [FARAH] });
      expect(db.get(`zaad_agents/${HODAN}`)!.openRequestId).toBeNull();
      expect(pushes("zaadAgent.no_agent")).toBe(0);
      // Hodan can no longer accept it.
      await expect(fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }))).rejects.toMatchObject({
        details: { reason: "offer_ended" },
      });
      await fns.agentAnswerZaadOffer(as(FARAH, { requestId: data.requestId, accept: false }));
      expect(req(db, data.requestId)).toMatchObject({ status: "no_agent", offeredToIds: [], offeredTo: null });
      expect(pushes("zaadAgent.no_agent", AMINA)).toBe(1);
    });

    it("nobody accepts in time: it ends no_agent, every ringing agent is freed and counted, two in a row take an agent offline", async () => {
      const db = seed({ farah: true });
      const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
      // Before the deadline the sweep leaves it alone.
      await runZaadAgentSweep(Date.now() + 30_000);
      expect(req(db, data.requestId).status).toBe("offered");

      await runZaadAgentSweep(Date.now() + 61_000);
      expect(req(db, data.requestId)).toMatchObject({ status: "no_agent", offeredToIds: [], offeredTo: null, deadlineAt: null });
      expect(db.get(`zaad_agents/${HODAN}`)).toMatchObject({ missedOffers: 1, online: true, openRequestIds: [] });
      expect(db.get(`zaad_agents/${FARAH}`)).toMatchObject({ missedOffers: 1, online: true, openRequestIds: [] });
      expect(req(db, data.requestId).offers.every((o: any) => o.answer === "timed_out")).toBe(true);
      expect(pushes("zaadAgent.no_agent", AMINA)).toBe(1);

      // The customer may ask again (no_agent isn't open); a second miss takes both offline.
      const again = (await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }))).data;
      expect(again.status).toBe("offered");
      await runZaadAgentSweep(Date.now() + 122_000);
      expect(db.get(`zaad_agents/${HODAN}`)!.online).toBe(false);
      expect(db.get(`zaad_agents/${FARAH}`)!.online).toBe(false);
    });

    it("the customer cancelling frees every agent it was ringing on", async () => {
      const db = seed({ farah: true });
      const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
      await fns.customerCancelZaadTopup(as(AMINA, { requestId: data.requestId }));
      expect(req(db, data.requestId)).toMatchObject({ status: "cancelled", offeredToIds: [] });
      expect(db.get(`zaad_agents/${HODAN}`)!.openRequestIds).toEqual([]);
      expect(db.get(`zaad_agents/${FARAH}`)!.openRequestIds).toEqual([]);
    });

    it("still reads a request written with one offeredTo", async () => {
      const db = seed();
      const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
      await db.doc(`zaadAgentTopups/${data.requestId}`).update({ offeredToIds: undefined, offeredTo: HODAN });
      await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }));
      expect(req(db, data.requestId).status).toBe("accepted");
    });
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
