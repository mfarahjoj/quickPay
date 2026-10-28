import * as crypto from "crypto";
import {
  assignEntry,
  decideReceipt,
  linkId,
  normaliseSomaliMsisdn,
  receiptId,
  refundEntry,
  suspenseEntry,
  topupEntry,
  ReceivedPayment,
  LinkedNumber,
} from "../mobileMoney/core";
import { validParse } from "../mobileMoney/parsers";
import { isOperatorSender, verifyListenerSignature } from "../mobileMoney/listener";
import { dialCode } from "../mobileMoney/linking";
import { DEFAULT_RATES } from "../config/rates";
import { validateEntry } from "../ledger/validate";

const payment: ReceivedPayment = {
  provider: "zaad",
  operatorTxnId: "TX123456",
  amountCents: 1000,
  currency: "USD",
  senderMsisdn: "+252634123456",
  senderName: "Abdi Warsame",
  receivedAtMs: Date.UTC(2026, 9, 22, 9),
};
const limits = { topupMinCents: 500, topupMaxCents: 10000 };
const link = (status: LinkedNumber["status"]): LinkedNumber => ({
  uid: "u1", provider: "zaad", msisdn: "+252634123456", status,
});
const sum = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((s, l) => s + l.debit - l.credit, 0);

describe("normaliseSomaliMsisdn", () => {
  it("reads every way a Somali number is written", () => {
    for (const raw of ["634123456", "0634123456", "252634123456", "00252634123456", "+252 63 412 3456"]) {
      expect(normaliseSomaliMsisdn(raw)).toBe("+252634123456");
    }
  });
  it("refuses anything else", () => {
    for (const raw of ["", "12345", "+447700900123", "063412345", null, undefined]) {
      expect(normaliseSomaliMsisdn(raw as string)).toBeNull();
    }
  });
});

describe("decideReceipt", () => {
  it("holds a payment from a number nobody linked", () => {
    expect(decideReceipt(payment, null, limits)).toEqual({ action: "suspense", reason: "unknown_sender", uid: null });
  });
  it("activates a pending link with whatever it sends", () => {
    expect(decideReceipt({ ...payment, amountCents: 10 }, link("pending"), limits)).toEqual({ action: "activate", uid: "u1" });
  });
  it("credits a verified number within the limits", () => {
    expect(decideReceipt(payment, link("verified"), limits)).toEqual({ action: "credit", uid: "u1" });
    expect(decideReceipt({ ...payment, amountCents: 500 }, link("verified"), limits).action).toBe("credit");
    expect(decideReceipt({ ...payment, amountCents: 10000 }, link("verified"), limits).action).toBe("credit");
  });
  it("holds amounts outside the limits, remembering who it was from", () => {
    expect(decideReceipt({ ...payment, amountCents: 499 }, link("verified"), limits))
      .toEqual({ action: "suspense", reason: "below_min", uid: "u1" });
    expect(decideReceipt({ ...payment, amountCents: 10001 }, link("verified"), limits))
      .toEqual({ action: "suspense", reason: "above_max", uid: "u1" });
  });
  it("holds shillings until shilling wallets exist", () => {
    expect(decideReceipt({ ...payment, currency: "SLSH" }, link("verified"), limits).action).toBe("suspense");
    expect(decideReceipt({ ...payment, currency: "SLSH" }, link("pending"), limits).action).toBe("suspense");
  });
});

describe("journal templates", () => {
  it("are zero-sum, valid, and keyed by the operator's transaction", () => {
    const entries = [
      topupEntry(payment, "u1", "t1"),
      suspenseEntry(payment),
      assignEntry("zaad_TX123456", 1000, "u1", "admin", "t2"),
      refundEntry("zaad_TX123456", "zaad", 1000, "admin"),
    ];
    for (const e of entries) {
      expect(sum(e.lines)).toBe(0);
      expect(() => validateEntry(e)).not.toThrow();
      expect(e.entryId).toContain("zaad_TX123456");
    }
  });
  it("credit the customer from the Zaad float, or hold it in suspense", () => {
    expect(topupEntry(payment, "u1", "t1").lines).toEqual([
      { account: "float:zaad", debit: 1000, credit: 0 },
      { account: "user:u1", debit: 0, credit: 1000 },
    ]);
    expect(suspenseEntry(payment).lines[1].account).toBe("platform:mm_suspense");
  });
  it("the same SMS always makes the same entry ID", () => {
    expect(topupEntry(payment, "u1", "t1").entryId).toBe(topupEntry(payment, "u1", "t9").entryId);
  });
});

describe("ids", () => {
  it("strip characters a document ID can't carry", () => {
    expect(receiptId("zaad", "AB/12.34")).toBe("zaad_AB1234");
    expect(() => receiptId("zaad", "///")).toThrow();
    expect(linkId("edahab", "+252654123456")).toBe("edahab_252654123456");
  });
});

describe("validParse", () => {
  it("only accepts a complete, sane payment", () => {
    expect(validParse(payment)).toBe(true);
    expect(validParse({ ...payment, amountCents: 0 })).toBe(false);
    expect(validParse({ ...payment, amountCents: 10.5 })).toBe(false);
    expect(validParse({ ...payment, senderMsisdn: "0634123456" })).toBe(false);
    expect(validParse({ ...payment, currency: "EUR" })).toBe(false);
    expect(validParse({ ...payment, operatorTxnId: "x" })).toBe(false);
  });
});

describe("listener", () => {
  const key = "device-key";
  const body = JSON.stringify({ type: "heartbeat" });
  const now = Date.UTC(2026, 9, 22, 9);
  const t = Math.floor(now / 1000);
  const v1 = crypto.createHmac("sha256", key).update(`${t}.${body}`).digest("hex");

  it("accepts only a fresh signature over the exact body", () => {
    expect(verifyListenerSignature(`t=${t},v1=${v1}`, Buffer.from(body), key, now)).toBe(true);
    expect(verifyListenerSignature(`t=${t},v1=${v1}`, `${body} `, key, now)).toBe(false);
    expect(verifyListenerSignature(`t=${t},v1=${v1}`, body, "other", now)).toBe(false);
    expect(verifyListenerSignature(`t=${t},v1=${v1}`, body, key, now + 10 * 60 * 1000)).toBe(false);
    expect(verifyListenerSignature(undefined, body, key, now)).toBe(false);
  });

  it("reads only the operator's official sender IDs", () => {
    expect(isOperatorSender("ZAAD", ["Zaad"])).toBe(true);
    expect(isOperatorSender("+252634000000", ["Zaad"])).toBe(false);
    expect(isOperatorSender("Zaad", [])).toBe(false);
    expect(isOperatorSender("Zaad", undefined)).toBe(false);
  });
});

describe("settings and dial codes", () => {
  it("default to $5–$100 top-ups and a 10¢ activation", () => {
    expect(DEFAULT_RATES.topupMinCents).toBe(500);
    expect(DEFAULT_RATES.topupMaxCents).toBe(10000);
    expect(DEFAULT_RATES.linkActivationCents).toBe(10);
    expect(DEFAULT_RATES.linkChangeCooldownHours).toBe(24);
  });
  it("prefill Zaad's dollar transfer to the collection number", () => {
    expect(dialCode("zaad", "+252634000001", 10)).toBe("*880*0634000001*0.10#");
    expect(dialCode("zaad", "+252634000001", 1000)).toBe("*880*0634000001*10.00#");
    expect(dialCode("edahab", "+252654000001", 1000)).toBeNull();
  });
});

describe("collectionUpdate", () => {
  // Imported here: adminDesk pulls in firebase-admin, which the pure tests above don't need.
  const { collectionUpdate } = require("../mobileMoney/adminDesk");

  it("normalises the number and cleans the sender IDs", () => {
    expect(collectionUpdate({ number: "063 400 0001", senderIds: " Zaad, ,Zaad,Telesom", active: true }))
      .toEqual({ number: "+252634000001", senderIds: ["Zaad", "Telesom"], active: true });
  });

  it("can be saved switched off and half-filled", () => {
    expect(collectionUpdate({ number: "", senderIds: [], active: false }))
      .toEqual({ number: null, senderIds: [], active: false });
  });

  it("won't switch top-ups on without a number and a sender ID", () => {
    expect(() => collectionUpdate({ number: "", senderIds: ["Zaad"], active: true })).toThrow(/number/);
    expect(() => collectionUpdate({ number: "0634000001", senderIds: [], active: true })).toThrow(/sender ID/);
  });

  it("refuses a number that isn't Somali", () => {
    expect(() => collectionUpdate({ number: "+447700900123" })).toThrow(/collection number/);
  });
});
