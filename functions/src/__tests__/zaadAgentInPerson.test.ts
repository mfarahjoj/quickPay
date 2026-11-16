import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { clearRatesCache } from "../config/rates";
import { runZaadAgentSweep } from "../zaadAgent/sweep";
import { expireAgentRequestsNow } from "../topup/expireAgentRequests";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const { Timestamp } = admin.firestore;

const AMINA = "cust-amina";
const HODAN = "agent-hodan";
const FARAH = "agent-farah";
const FLOAT = 10_000; // $100
const CODE = "123456";

const balance = (db: FakeDb, account: string) => db.get(`ledger_balances/${account}`)?.balance ?? 0;

/**
 * Zaad paid to an agent in person (ZAPP_AGENT_TOPUP_ONE_FLOW_PLAN.md §5).
 * The customer shows the same code as for cash; the agent scans it and
 * chooses Zaad; from there it is the remote Zaad flow with the agent already
 * chosen. The ledger, limits, lockout and sweep are real.
 */
describe("Zaad in person", () => {
  let fns: Record<string, any>;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const modules = [
      await import("../zaadAgent/customer"),
      await import("../zaadAgent/agent"),
      await import("../zaadAgent/inPerson"),
      await import("../topup/agentConfirmTopup"),
    ];
    fns = Object.fromEntries(
      modules
        .flatMap((m) => Object.entries(m))
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

  const cashRequest = (amount = 1000, extra: Record<string, any> = {}) => ({
    customerId: AMINA,
    amount,
    currency: "USD",
    otpCode: CODE,
    status: "pending",
    expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
    createdAt: Timestamp.now(),
    ...extra,
  });

  const seed = (opts: { rates?: Record<string, any>; extra?: Record<string, any> } = {}): FakeDb => {
    const db = fakeFirestore({
      "config/rates": { zaadAgentTopups: "on", ...opts.rates },
      [`users/${AMINA}`]: { accountType: "customer", fullName: "Amina Yusuf", kycStatus: "verified", phoneNumber: "+252634120987" },
      [`users/${HODAN}`]: { accountType: "topup_agent", fullName: "Hodan Ali", kycStatus: "verified", agentInfo: { businessName: "Hodan's Shop" } },
      [`users/${FARAH}`]: { accountType: "topup_agent", fullName: "Farah Omar", kycStatus: "verified" },
      [`wallets/${AMINA}`]: wallet(0),
      [`wallets/${HODAN}`]: wallet(0),
      [`wallets/${FARAH}`]: wallet(0),
      [`ledger_balances/agent:${HODAN}`]: { account: `agent:${HODAN}`, balance: FLOAT, currency: "USD" },
      [`ledger_balances/agent:${FARAH}`]: { account: `agent:${FARAH}`, balance: FLOAT, currency: "USD" },
      [`zaad_agents/${HODAN}`]: zaadAgent(),
      "agentTopupRequests/cash-1": cashRequest(),
      ...opts.extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const as = (uid: string, data: Record<string, unknown> = {}) => ({ data, auth: { uid, token: {} } });
  const start = (uid = HODAN, extra: Record<string, unknown> = {}) =>
    fns.agentStartZaadInPerson(as(uid, { requestId: "cash-1", otpCode: CODE, expectedAmount: 1000, ...extra }));

  it("the cash scan names the agent for the customer's screen", async () => {
    const db = seed();
    await fns.previewAgentTopup(as(HODAN, { requestId: "cash-1", otpCode: CODE }));
    expect(db.get("agentTopupRequests/cash-1")).toMatchObject({ scannedBy: HODAN, scannedByName: "Hodan's Shop" });
  });

  it("scan → Zaad → paid with no transaction ID → confirmed: credited once at the Zaad rate", async () => {
    const db = seed({ rates: { zaadAgentTopupCommissionRate: 0.03 } });
    const res = await start();
    const id = res.data.requestId;
    expect(res.data.allowedSenders).toEqual(["063 ••• 0987"]);
    expect(db.get("agentTopupRequests/cash-1")).toMatchObject({ status: "moved_to_zaad", zaadRequestId: id });
    expect(db.get(`zaadAgentTopups/${id}`)).toMatchObject({
      status: "accepted",
      meeting: "in_person",
      agentId: HODAN,
      agentName: "Hodan's Shop",
      dialCode: "*880*0634777001*10.00#",
      offers: [],
    });
    // The float is set aside the moment the agent chooses Zaad.
    expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT - 1000);
    expect(balance(db, "platform:zaad_agent_hold")).toBe(1000);
    // D26: an in-person request doesn't take the agent's offer slot.
    expect(db.get(`zaad_agents/${HODAN}`)!.openRequestId).toBeNull();

    await fns.customerMarkZaadSent(as(AMINA, { requestId: id }));
    expect(db.get(`zaadAgentTopups/${id}`)!.status).toBe("customer_sent");
    await fns.agentConfirmZaadTopup(as(HODAN, { requestId: id, answer: "received", expectedAmount: 1000, agentPin: "1" }));

    expect(db.get(`wallets/${AMINA}`)!.balance).toBe(1000);
    expect(db.get(`wallets/${HODAN}`)!.balance).toBe(30);
    expect(balance(db, "platform:zaad_agent_hold")).toBe(0);
    expect(db.get(`transactions/zaadagent_${id}`)).toMatchObject({
      agentName: "Hodan's Shop",
      paidBy: "zaad",
      meeting: "in_person",
      description: "Top-up from Hodan's Shop (Zaad)",
    });
    // The cash request can't be confirmed as cash any more.
    await expect(
      fns.agentConfirmTopup(as(HODAN, { requestId: "cash-1", otpCode: CODE, agentPin: "1", expectedAmount: 1000 }))
    ).rejects.toThrow();
    expect(db.get(`wallets/${AMINA}`)!.balance).toBe(1000);
  });

  it("starting twice makes one Zaad request", async () => {
    const db = seed();
    const a = await start();
    const b = await start();
    expect(b.data.requestId).toBe(a.data.requestId);
    expect([...db.store.keys()].filter((p) => p.startsWith("zaadAgentTopups/"))).toHaveLength(1);
    expect(balance(db, "platform:zaad_agent_hold")).toBe(1000);
  });

  it("is refused while the switch is off", async () => {
    const db = seed({ rates: { zaadAgentTopups: "off" } });
    await expect(start()).rejects.toMatchObject({ details: { reason: "off" } });
    expect(db.get("agentTopupRequests/cash-1")!.status).toBe("pending");
  });

  it("is refused for an agent without an ops-checked Zaad number", async () => {
    seed({ extra: { [`zaad_agents/${HODAN}`]: zaadAgent({ receiveMsisdn: null }) } });
    await expect(start()).rejects.toMatchObject({ details: { reason: "zaad_not_set_up" } });
    await expect(start(FARAH)).rejects.toMatchObject({ details: { reason: "zaad_not_set_up" } });
  });

  it("is refused for shillings, over the limit, and for a blocked customer", async () => {
    seed({ extra: { "agentTopupRequests/cash-1": cashRequest(30_000, { currency: "SLS" }) } });
    await expect(start(HODAN, { expectedAmount: 30_000 })).rejects.toMatchObject({ details: { reason: "zaad_dollars_only" } });
    restore?.();

    seed({ extra: { "agentTopupRequests/cash-1": cashRequest(50_000) } });
    await expect(start(HODAN, { expectedAmount: 50_000 })).rejects.toMatchObject({ details: { reason: "amount_out_of_range" } });
    restore?.();

    seed({ extra: { [`zaad_agent_customers/${AMINA}`]: { blocked: true } } });
    await expect(start()).rejects.toMatchObject({ details: { reason: "blocked" } });
  });

  it("is refused while the customer has another Zaad top-up in progress", async () => {
    seed({
      extra: {
        "zaadAgentTopups/open-1": { customerId: AMINA, amount: 500, status: "customer_sent", createdAt: Timestamp.now() },
        [`zaad_agent_customers/${AMINA}`]: { activeRequestId: "open-1" },
      },
    });
    await expect(start()).rejects.toMatchObject({ details: { reason: "in_progress" } });
  });

  it("is refused, holding nothing, when the float is too low", async () => {
    const db = seed({ extra: { [`ledger_balances/agent:${HODAN}`]: { account: `agent:${HODAN}`, balance: 500, currency: "USD" } } });
    await expect(start()).rejects.toMatchObject({ details: { reason: "insufficient_float" } });
    expect(balance(db, "platform:zaad_agent_hold")).toBe(0);
    expect(db.get("agentTopupRequests/cash-1")!.status).toBe("pending");
  });

  it("counts a wrong code like the cash scan does", async () => {
    const db = seed();
    await expect(start(HODAN, { otpCode: "999999" })).rejects.toThrow(/Invalid or expired code/);
    expect(db.get("agentTopupRequests/cash-1")!.status).toBe("pending");
    expect(db.get(`users/${HODAN}`)!.agentOtpFailedAttempts).toBe(1);
  });

  it("the cash expiry sweep leaves a moved request alone", async () => {
    const db = seed();
    await start();
    await db.doc("agentTopupRequests/cash-1").update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await expireAgentRequestsNow();
    expect(db.get("agentTopupRequests/cash-1")!.status).toBe("moved_to_zaad");
  });

  it("D26: an in-person request and a remote offer don't block each other", async () => {
    const db = seed();
    const inPerson = (await start()).data.requestId;
    // Another customer asks remotely: Hodan is still offered it.
    db.store.set("users/cust-bashir", { accountType: "customer", fullName: "Bashir Ali", kycStatus: "verified", phoneNumber: "+252634555111" });
    db.store.set("wallets/cust-bashir", wallet(0));
    const remote = await fns.customerRequestZaadAgentTopup({ data: { amount: 2000 }, auth: { uid: "cust-bashir", token: {} } });
    expect(db.get(`zaadAgentTopups/${remote.data.requestId}`)!.offeredTo).toBe(HODAN);
    await fns.agentAnswerZaadOffer(as(HODAN, { requestId: remote.data.requestId, accept: true }));
    // Both held, from free float.
    expect(balance(db, "platform:zaad_agent_hold")).toBe(3000);
    expect(balance(db, `agent:${HODAN}`)).toBe(FLOAT - 3000);
    expect(db.get(`zaadAgentTopups/${inPerson}`)!.status).toBe("accepted");
  });

  it("an open remote request doesn't stop an in-person start", async () => {
    const db = seed({ extra: { [`zaad_agents/${HODAN}`]: zaadAgent({ openRequestId: "remote-x" }) } });
    const res = await start();
    expect(db.get(`zaadAgentTopups/${res.data.requestId}`)!.status).toBe("accepted");
    expect(db.get(`zaad_agents/${HODAN}`)!.openRequestId).toBe("remote-x");
  });

  it("unanswered in person → dispute with the hold in place, and the agent stays online", async () => {
    const db = seed();
    const id = (await start()).data.requestId;
    await fns.customerMarkZaadSent(as(AMINA, { requestId: id }));
    await runZaadAgentSweep(Date.now() + 16 * 60_000);
    expect(db.get(`zaadAgentTopups/${id}`)).toMatchObject({ status: "disputed", disputedBy: "timeout" });
    expect(balance(db, "platform:zaad_agent_hold")).toBe(1000);
    expect(db.get(`zaad_agents/${HODAN}`)).toMatchObject({ online: true, missedOffers: 0 });
  });

  it("a transaction ID given in person still claims it once", async () => {
    const db = seed();
    const id = (await start()).data.requestId;
    await fns.customerMarkZaadSent(as(AMINA, { requestId: id, zaadTxnId: "zt 555" }));
    expect(db.get(`zaadAgentTopups/${id}`)!.customerZaadTxnId).toBe("ZT555");
    expect(db.get("zaad_agent_txn_ids/ZT555")).toBeDefined();
  });

  it("remote still requires the transaction ID", async () => {
    seed();
    const { data } = await fns.customerRequestZaadAgentTopup(as(AMINA, { amount: 1000 }));
    await fns.agentAnswerZaadOffer(as(HODAN, { requestId: data.requestId, accept: true }));
    await expect(fns.customerMarkZaadSent(as(AMINA, { requestId: data.requestId }))).rejects.toMatchObject({
      details: { reason: "txn_id" },
    });
  });

  it("cash confirm writes the agent's name and how the customer paid", async () => {
    const db = seed();
    await fns.previewAgentTopup(as(HODAN, { requestId: "cash-1", otpCode: CODE }));
    const res = await fns.agentConfirmTopup(as(HODAN, { requestId: "cash-1", otpCode: CODE, agentPin: "1", expectedAmount: 1000 }));
    expect(db.get(`transactions/${res.data.confirmationId}`)).toMatchObject({
      agentName: "Hodan's Shop",
      paidBy: "cash",
      description: "Top-up from Hodan's Shop (cash)",
    });
  });
});
