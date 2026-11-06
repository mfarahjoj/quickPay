import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));

import { verifyUserPin } from "../auth/validatePin";
import { normaliseZaadName, zaadLabel, zaadPayoutBlock } from "../auth/zaadAccount";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const { Timestamp } = admin.firestore;

const UID = "user-1";
const HOUR = 3600 * 1000;

describe("Zaad name", () => {
  it("keeps a full name, tidying the spaces", () => {
    expect(normaliseZaadName("  Amina   Yusuf Ali ")).toBe("Amina Yusuf Ali");
    expect(normaliseZaadName("Cabdi O'Brien Xasan-Faarax")).toBe("Cabdi O'Brien Xasan-Faarax");
    expect(normaliseZaadName("أمينة يوسف")).toBe("أمينة يوسف");
  });

  it("refuses one word, numbers and very long names", () => {
    expect(normaliseZaadName("Amina")).toBeNull();
    expect(normaliseZaadName("Amina 0634123456")).toBeNull();
    expect(normaliseZaadName(`Amina ${"Y".repeat(60)}`)).toBeNull();
    expect(normaliseZaadName(42)).toBeNull();
  });

  it("labels the number the way people read it", () => {
    expect(zaadLabel("+252634123456")).toBe("Zaad 063 412 3456");
  });
});

describe("zaadPayoutBlock", () => {
  const now = Date.now();
  const zaad = (extra: Record<string, unknown> = {}) =>
    ({ zaad: { msisdn: "+252634123456", name: "Amina Yusuf", updatedAt: Timestamp.now(), ...extra } }) as any;

  it("needs an account on file", () => {
    expect(zaadPayoutBlock({}, 24, now)).toBe("missing");
    expect(zaadPayoutBlock(undefined, 24, now)).toBe("missing");
  });

  it("waits out the hold after a new number, then lets payouts through", () => {
    expect(zaadPayoutBlock(zaad({ changedAt: Timestamp.fromMillis(now - 2 * HOUR) }), 24, now)).toBe("changed_recently");
    expect(zaadPayoutBlock(zaad({ changedAt: Timestamp.fromMillis(now - 25 * HOUR) }), 24, now)).toBeNull();
    expect(zaadPayoutBlock(zaad(), 24, now)).toBeNull();
  });
});

describe("setZaadAccount", () => {
  let setZaad: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    setZaad = test.wrap((await import("../auth/zaadAccount")).setZaadAccount);
  });
  beforeEach(() => mockedPin.mockReset().mockResolvedValue(true));
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  const seed = (user: Record<string, unknown> = {}): FakeDb => {
    const db = fakeFirestore({ [`users/${UID}`]: { accountType: "customer", fullName: "Amina Yusuf", ...user } });
    restore = useFakeFirestore(db);
    return db;
  };
  const call = (data: Record<string, unknown>) => setZaad({ data, auth: { uid: UID } });

  it("saves the first account without a PIN, in E.164", async () => {
    const db = seed();
    await call({ msisdn: "063 412 3456", name: "amina  yusuf" });
    const zaad = db.get(`users/${UID}`)!.zaad;
    expect(zaad).toMatchObject({ msisdn: "+252634123456", name: "amina yusuf" });
    expect(zaad.changedAt).toBeUndefined();
    expect(mockedPin).not.toHaveBeenCalled();
  });

  it("refuses a number that isn't Somali and a one-word name", async () => {
    seed();
    await expect(call({ msisdn: "12345", name: "Amina Yusuf" })).rejects.toThrow(/number like 063/);
    await expect(call({ msisdn: "0634123456", name: "Amina" })).rejects.toThrow(/full name/);
  });

  it("takes the PIN to change it, and starts the payout wait for a new number", async () => {
    const before = { msisdn: "+252634123456", name: "Amina Yusuf", updatedAt: Timestamp.now() };
    const db = seed({ zaad: before });
    await expect(call({ msisdn: "0634999999", name: "Amina Yusuf" })).rejects.toThrow(/PIN is required/);
    mockedPin.mockResolvedValue(false);
    await expect(call({ msisdn: "0634999999", name: "Amina Yusuf", pin: "000000" })).rejects.toThrow(/Invalid PIN/);
    expect(db.get(`users/${UID}`)!.zaad.msisdn).toBe("+252634123456");

    mockedPin.mockResolvedValue(true);
    await call({ msisdn: "0634999999", name: "Amina Yusuf", pin: "123456" });
    const zaad = db.get(`users/${UID}`)!.zaad;
    expect(zaad.msisdn).toBe("+252634999999");
    expect(zaad.changedAt).toBeDefined();
  });

  it("fixes the name without starting the wait, and ignores a resend", async () => {
    const before = { msisdn: "+252634123456", name: "Amina Yusf", updatedAt: Timestamp.now() };
    const db = seed({ zaad: before });
    await call({ msisdn: "+252634123456", name: "Amina Yusuf", pin: "123456" });
    expect(db.get(`users/${UID}`)!.zaad).toMatchObject({ name: "Amina Yusuf" });
    expect(db.get(`users/${UID}`)!.zaad.changedAt).toBeUndefined();

    mockedPin.mockClear();
    await call({ msisdn: "0634123456", name: "Amina Yusuf" });
    expect(mockedPin).not.toHaveBeenCalled();
  });
});
