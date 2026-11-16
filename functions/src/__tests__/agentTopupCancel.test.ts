import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const mockedNotify = notifyUser as jest.MockedFunction<typeof notifyUser>;

const AGENT = "agent-1";
const AMINA = "cust-amina";
const BASHIR = "cust-bashir";
const { Timestamp } = admin.firestore;
const FLOAT = 100_000;

/**
 * The customer cancels a cash top-up code before the agent confirms it. No
 * money has moved yet, so cancelling only closes the request; what matters is
 * that the agent can't confirm it afterwards, and is told why.
 */
describe("customer cancels a cash top-up", () => {
  let cancel: any;
  let preview: any;
  let confirm: any;
  let openDispute: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    cancel = test.wrap((await import("../topup/customerCancelAgentTopup")).customerCancelAgentTopup);
    const mod = await import("../topup/agentConfirmTopup");
    preview = test.wrap(mod.previewAgentTopup);
    confirm = test.wrap(mod.agentConfirmTopup);
    openDispute = test.wrap((await import("../disputes/disputes")).openDispute);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPin.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const request = (extra: Record<string, any> = {}) => ({
    customerId: AMINA,
    amount: 5_000,
    currency: "USD",
    otpCode: "123456",
    status: "pending",
    expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
    createdAt: Timestamp.now(),
    ...extra,
  });

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Hodan's Shop", kycStatus: "verified" },
      [`users/${AMINA}`]: { accountType: "customer", fullName: "Amina Yusuf", kycStatus: "verified" },
      [`users/${BASHIR}`]: { accountType: "customer", fullName: "Bashir Ali", kycStatus: "verified" },
      [`wallets/${AGENT}`]: wallet(0),
      [`ledger_balances/agent:${AGENT}`]: { account: `agent:${AGENT}`, balance: FLOAT, currency: "USD" },
      [`wallets/${AMINA}`]: wallet(0),
      "agentTopupRequests/req-amina": request(),
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const as = (uid: string, data: Record<string, unknown>) => ({ data, auth: { uid } });
  const confirmData = { otpCode: "123456", agentPin: "246810", requestId: "req-amina", expectedAmount: 5_000 };
  const journalEntries = (db: FakeDb) => [...db.store.keys()].filter((p) => p.startsWith("journal_entries/"));

  it("closes a pending request, and no agent can confirm it after", async () => {
    const db = seed();
    const res = await cancel(as(AMINA, { requestId: "req-amina" }));
    expect(res.data).toEqual({ status: "cancelled" });
    expect(db.get("agentTopupRequests/req-amina")).toMatchObject({ status: "cancelled", cancelledBy: "customer" });

    await expect(confirm(as(AGENT, confirmData))).rejects.toMatchObject({ code: "not-found" });
    expect(journalEntries(db)).toHaveLength(0);
    expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(FLOAT);
    expect(db.get(`wallets/${AMINA}`)!.balance).toBe(0);
    // Nobody scanned it: nobody to tell.
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it("tells the agent who scanned it, by push and when they try to confirm", async () => {
    const db = seed();
    await preview(as(AGENT, { otpCode: "123456", requestId: "req-amina" }));
    await cancel(as(AMINA, { requestId: "req-amina" }));

    expect(mockedNotify).toHaveBeenCalledWith(
      AGENT,
      "topup_cancelled",
      expect.objectContaining({ key: "topup.cancelled_by_customer", params: { amount: expect.any(String) } }),
      { type: "topup_cancelled", requestId: "req-amina" }
    );
    await expect(confirm(as(AGENT, confirmData))).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "customer_cancelled" },
    });
    expect(journalEntries(db)).toHaveLength(0);
    // The right code is not counted as a wrong guess.
    expect(db.get(`users/${AGENT}`)!.agentOtpFailedAttempts ?? 0).toBe(0);
  });

  it("says nothing about the cancel to an agent who never scanned it, or with the wrong code", async () => {
    seed({ "users/agent-2": { accountType: "topup_agent", fullName: "Other", kycStatus: "verified" } });
    await preview(as(AGENT, { otpCode: "123456", requestId: "req-amina" }));
    await cancel(as(AMINA, { requestId: "req-amina" }));
    await expect(confirm(as("agent-2", confirmData))).rejects.toMatchObject({ code: "not-found" });
    await expect(confirm(as(AGENT, { ...confirmData, otpCode: "654321" }))).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("refuses once the agent has topped up the wallet", async () => {
    const db = seed();
    await confirm(as(AGENT, confirmData));
    await expect(cancel(as(AMINA, { requestId: "req-amina" }))).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "completed" },
    });
    expect(db.get("agentTopupRequests/req-amina")!.status).toBe("completed");
    expect(db.get(`wallets/${AMINA}`)!.balance).toBe(5_000);
  });

  it("answers with the Zaad request when the agent moved it to Zaad first", async () => {
    const db = seed({
      "agentTopupRequests/req-amina": request({ status: "moved_to_zaad", zaadRequestId: "zaad-1" }),
    });
    const res = await cancel(as(AMINA, { requestId: "req-amina" }));
    expect(res.data).toEqual({ status: "moved_to_zaad", zaadRequestId: "zaad-1" });
    expect(db.get("agentTopupRequests/req-amina")!.status).toBe("moved_to_zaad");
  });

  it("is harmless twice, and on an expired request", async () => {
    const db = seed({ "agentTopupRequests/req-old": request({ status: "expired" }) });
    await cancel(as(AMINA, { requestId: "req-amina" }));
    const again = await cancel(as(AMINA, { requestId: "req-amina" }));
    expect(again.data).toEqual({ status: "cancelled" });
    const old = await cancel(as(AMINA, { requestId: "req-old" }));
    expect(old.data).toEqual({ status: "expired" });
    expect(db.get("agentTopupRequests/req-old")!.status).toBe("expired");
  });

  it("is only the customer's own: anyone else reads not found", async () => {
    const db = seed();
    await expect(cancel(as(BASHIR, { requestId: "req-amina" }))).rejects.toMatchObject({ code: "not-found" });
    await expect(cancel(as(AGENT, { requestId: "req-amina" }))).rejects.toMatchObject({ code: "not-found" });
    await expect(cancel(as(AMINA, { requestId: "nope" }))).rejects.toMatchObject({ code: "not-found" });
    await expect(cancel(as(AMINA, { requestId: "" }))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(cancel(as(AMINA, { requestId: "a/b" }))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(cancel({ data: { requestId: "req-amina" } })).rejects.toThrow();
    expect(db.get("agentTopupRequests/req-amina")!.status).toBe("pending");
  });

  it("still lets the customer claim cash they handed over before cancelling", async () => {
    seed();
    await preview(as(AGENT, { otpCode: "123456", requestId: "req-amina" }));
    await cancel(as(AMINA, { requestId: "req-amina" }));
    const res = await openDispute(
      as(AMINA, {
        agentTopupRequestId: "req-amina",
        kind: "cash_given_not_credited",
        note: "Handed the cash, then cancelled by mistake",
      })
    );
    expect(res.data.status).toBeDefined();
  });
});
