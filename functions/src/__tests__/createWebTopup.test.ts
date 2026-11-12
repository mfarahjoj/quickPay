import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

/**
 * createWebTopup was public and answered "whose number is this?" for anyone.
 * It is switched off; these pin that it reveals nothing and writes nothing.
 */
describe("createWebTopup is switched off", () => {
  let createWebTopup: any;
  let restore: () => void;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    createWebTopup = (await import("../remittance/createWebTopup")).createWebTopup;
  });

  afterEach(() => restore?.());
  afterAll(() => test.cleanup());

  const mockRes = () => {
    const res: any = {
      statusCode: 0,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      },
      send(payload: any) {
        this.body = payload;
        return this;
      },
    };
    return res;
  };

  const seed = () => {
    const db = fakeFirestore({
      "users/u1": { phoneNumber: "+252630000001", fullName: "Amina Yusuf" },
    });
    restore = useFakeFirestore(db);
    return db;
  };

  it.each([
    ["a name lookup", { recipientPhone: "+252630000001", lookupOnly: true }],
    ["a top-up", { recipientPhone: "+252630000001", amountUsd: 1_000 }],
  ])("answers %s with 503 and no name", async (_label, body) => {
    const db = seed();
    const res = mockRes();
    await createWebTopup({ method: "POST", headers: {}, body } as any, res);
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("Amina");
    expect([...db.store.keys()].some((p) => p.startsWith("webTopups/"))).toBe(false);
  });
});
