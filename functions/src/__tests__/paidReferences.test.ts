import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import {
  PAID_REFERENCES,
  cleanReference,
  findPaidReference,
  guardPaidReference,
  recordPaidReference,
  referenceKey,
} from "../utils/paidReferences";

/** In-memory documents behind just enough of the Firestore API. */
function fakeDb(docs: Record<string, any> = {}) {
  const reads: string[] = [];
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => {
        const path = `${name}/${id}`;
        return {
          path,
          get: async () => {
            reads.push(path);
            return { exists: path in docs, data: () => docs[path] };
          },
        };
      },
    }),
  } as unknown as FirebaseFirestore.Firestore;
  return { db, reads };
}

const at = (iso: string) => admin.firestore.Timestamp.fromDate(new Date(iso));

describe("paid references", () => {
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });

  describe("referenceKey", () => {
    it("matches one invoice however it was entered", () => {
      const keys = ["Invoice No 37841", "INVOICE NO.:37841", "invoice #37841", "37841", " 37841 "].map(
        referenceKey
      );
      expect(new Set(keys)).toEqual(new Set(["37841"]));
    });

    it("keeps labels that are part of what identifies the sale", () => {
      expect(referenceKey("Table 4")).toBe("table4");
      expect(referenceKey("KOT No 65")).toBe("kotno65");
    });

    it("keeps a reference made only of a label word", () => {
      expect(referenceKey("Invoice")).toBe("invoice");
    });

    it("works in any script", () => {
      expect(referenceKey("فاتورة ٣٧٨٤١")).toBe("فاتورة٣٧٨٤١");
    });

    it("has nothing to match in punctuation", () => {
      expect(referenceKey(" -- # ")).toBeNull();
    });
  });

  describe("cleanReference", () => {
    it("trims, and treats blank as none", () => {
      expect(cleanReference("  Invoice No 37841 ")).toBe("Invoice No 37841");
      expect(cleanReference("   ")).toBeUndefined();
      expect(cleanReference(undefined)).toBeUndefined();
    });

    it("refuses what isn't a short piece of text", () => {
      expect(() => cleanReference(37841)).toThrow(https.HttpsError);
      expect(() => cleanReference("x".repeat(81))).toThrow(/at most/);
    });
  });

  describe("recordPaidReference", () => {
    it("writes one merged marker per merchant and invoice, with a running count", () => {
      const { db } = fakeDb();
      const sets: any[] = [];
      const tx = { set: (ref: any, data: any, options: any) => sets.push({ path: ref.path, data, options }) };

      recordPaidReference(tx, db, {
        merchantId: "merchant-1",
        reference: "Invoice No 37841",
        transactionId: "tx-1",
        receiptNumber: "ZP-7M3N-9QX2",
        amount: 256,
        currency: "USD",
        paidByName: "Ahmed Ali",
      });

      expect(sets).toHaveLength(1);
      expect(sets[0].path).toBe(`${PAID_REFERENCES}/merchant-1_37841`);
      expect(sets[0].options).toEqual({ merge: true });
      expect(sets[0].data).toMatchObject({
        merchantId: "merchant-1",
        reference: "Invoice No 37841",
        key: "37841",
        transactionId: "tx-1",
        receiptNumber: "ZP-7M3N-9QX2",
        amount: 256,
      });
      expect(sets[0].data.count).toBeDefined();
    });

    it("writes nothing for a reference with nothing to match", () => {
      const { db } = fakeDb();
      const tx = { set: jest.fn() };
      recordPaidReference(tx, db, {
        merchantId: "merchant-1",
        reference: "--",
        transactionId: "tx-1",
        receiptNumber: "ZP-7M3N-9QX2",
        amount: 256,
        currency: "USD",
        paidByName: null,
      });
      expect(tx.set).not.toHaveBeenCalled();
    });
  });

  describe("findPaidReference / guardPaidReference", () => {
    const marker = {
      merchantId: "merchant-1",
      reference: "Invoice No 37841",
      transactionId: "tx-1",
      receiptNumber: "ZP-7M3N-9QX2",
      amount: 256,
      currency: "USD",
      paidByName: "Ahmed Ali",
      paidAt: at("2026-11-12T11:37:28Z"),
      count: 1,
    };
    const paid = {
      [`${PAID_REFERENCES}/merchant-1_37841`]: marker,
      "transactions/tx-1": { createdAt: at("2026-11-12T11:37:28Z") },
    };

    it("finds a paid invoice however it is typed the second time", async () => {
      const { db } = fakeDb(paid);
      expect(await findPaidReference(db, "merchant-1", "37841")).toEqual({
        reference: "Invoice No 37841",
        receiptNumber: "ZP-7M3N-9QX2",
        amount: 256,
        currency: "USD",
        paidByName: "Ahmed Ali",
        paidAt: "2026-11-12T11:37:28.000Z",
        count: 1,
      });
    });

    it("is scoped to the merchant", async () => {
      const { db } = fakeDb(paid);
      expect(await findPaidReference(db, "merchant-2", "Invoice No 37841")).toBeNull();
    });

    it("ignores a payment that was refunded", async () => {
      const { db } = fakeDb({
        ...paid,
        "transactions/tx-1": { createdAt: at("2026-11-12T11:37:28Z"), refundedAt: at("2026-11-12T12:00:00Z") },
      });
      expect(await findPaidReference(db, "merchant-1", "Invoice No 37841")).toBeNull();
    });

    it("refuses a paid invoice with the earlier payment attached", async () => {
      const { db } = fakeDb(paid);
      const err = await guardPaidReference(db, "merchant-1", "Invoice No 37841", { check: true }).catch(
        (e) => e
      );
      expect(err).toBeInstanceOf(https.HttpsError);
      expect(err.code).toBe("already-exists");
      expect(err.details.priorPayment.receiptNumber).toBe("ZP-7M3N-9QX2");
    });

    it("lets the merchant go ahead once they've seen the warning", async () => {
      const { db } = fakeDb(paid);
      await expect(
        guardPaidReference(db, "merchant-1", "Invoice No 37841", { check: true, confirmed: true })
      ).resolves.toBeUndefined();
    });

    it("does not look anything up unless the app asks (older apps, table numbers)", async () => {
      const { db, reads } = fakeDb(paid);
      await expect(guardPaidReference(db, "merchant-1", "Invoice No 37841", {})).resolves.toBeUndefined();
      await expect(
        guardPaidReference(db, "merchant-1", "Invoice No 37841", { check: "yes" })
      ).resolves.toBeUndefined();
      await expect(guardPaidReference(db, "merchant-1", undefined, { check: true })).resolves.toBeUndefined();
      expect(reads).toEqual([]);
    });

    it("lets a never-paid invoice through", async () => {
      const { db } = fakeDb(paid);
      await expect(
        guardPaidReference(db, "merchant-1", "Invoice No 37842", { check: true })
      ).resolves.toBeUndefined();
    });
  });
});
