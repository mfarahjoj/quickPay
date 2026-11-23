import * as admin from "firebase-admin";
import {
  RECEIPT_NUMBERS,
  claimReceiptNumber,
  generateReceiptNumber,
  normalizeReceiptNumber,
  reserveReceiptNumber,
} from "../utils/receiptNumber";

/** Just enough of a Firestore db and transaction to see what gets touched. */
function fakeDb(existing: string[] = []) {
  const taken = new Set(existing);
  const reads: string[] = [];
  const creates: { path: string; data: any }[] = [];
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
    }),
  } as unknown as FirebaseFirestore.Firestore;
  const tx = {
    get: async (ref: any) => {
      reads.push(ref.path);
      return { exists: taken.has(ref.path) };
    },
    create: (ref: any, data: any) => {
      creates.push({ path: ref.path, data });
    },
  };
  return { db, tx, reads, creates };
}

/** randomInt that walks a fixed list of indexes into the alphabet. */
const scripted = (indexes: number[]) => {
  let i = 0;
  return () => indexes[i++ % indexes.length];
};

describe("receipt numbers", () => {
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });

  describe("generateReceiptNumber", () => {
    it("formats as ZP-XXXX-XXXX", () => {
      for (let i = 0; i < 200; i++) {
        expect(generateReceiptNumber()).toMatch(/^ZP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      }
    });

    it("never prints a character that can be misread", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 2000; i++) {
        for (const ch of generateReceiptNumber().slice(3).replace("-", "")) seen.add(ch);
      }
      for (const ch of ["I", "L", "O", "U"]) expect(seen.has(ch)).toBe(false);
    });

    it("uses the random source it is given", () => {
      expect(generateReceiptNumber(scripted([7, 20, 3, 21, 9, 23, 29, 2]))).toBe("ZP-7M3N-9QX2");
    });
  });

  describe("normalizeReceiptNumber", () => {
    it.each([
      ["ZP-7M3N-9QX2", "ZP-7M3N-9QX2"],
      ["zp 7m3n 9qx2", "ZP-7M3N-9QX2"],
      ["7M3N-9QX2", "ZP-7M3N-9QX2"],
      ["ZP7M3N9QX2", "ZP-7M3N-9QX2"],
      // What people mistype or misread
      ["ZP-7M3N-9QXO", "ZP-7M3N-9QX0"],
      ["zp-7m3n-iqx2", "ZP-7M3N-1QX2"],
      ["ZP-7M3N-LQX2", "ZP-7M3N-1QX2"],
    ])("reads %s as %s", (input, expected) => {
      expect(normalizeReceiptNumber(input)).toBe(expected);
    });

    it.each(["", "ZP-7M3N-9QX", "ZP-7M3N-9QX22", "ZP-7M3N-9QXU", "hello", "37841"])(
      "rejects %s",
      (input) => {
        expect(normalizeReceiptNumber(input)).toBeNull();
      }
    );
  });

  describe("claimReceiptNumber", () => {
    it("claims a free number with a single read", async () => {
      const { db, tx, reads } = fakeDb();
      const n = await claimReceiptNumber(tx, db, scripted([7, 20, 3, 21, 9, 23, 29, 2]));
      expect(n).toBe("ZP-7M3N-9QX2");
      expect(reads).toEqual([`${RECEIPT_NUMBERS}/ZP-7M3N-9QX2`]);
    });

    it("skips a number that is already held", async () => {
      const { db, tx, reads } = fakeDb([`${RECEIPT_NUMBERS}/ZP-0000-0000`]);
      const random = scripted([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
      expect(await claimReceiptNumber(tx, db, random)).toBe("ZP-1111-1111");
      expect(reads).toHaveLength(2);
    });

    it("gives up rather than issue a number twice", async () => {
      const { db, tx } = fakeDb([`${RECEIPT_NUMBERS}/ZP-0000-0000`]);
      await expect(claimReceiptNumber(tx, db, () => 0)).rejects.toThrow(/receipt number/);
    });
  });

  describe("reserveReceiptNumber", () => {
    it("creates (never overwrites) the reservation that indexes the transaction", () => {
      const { db, tx, creates } = fakeDb();
      reserveReceiptNumber(tx, db, "ZP-7M3N-9QX2", {
        transactionId: "tx-1",
        type: "payment",
        participants: ["customer-1", "merchant-1"],
        amount: 256,
        currency: "USD",
      });
      expect(creates).toHaveLength(1);
      expect(creates[0].path).toBe(`${RECEIPT_NUMBERS}/ZP-7M3N-9QX2`);
      expect(creates[0].data).toMatchObject({
        transactionId: "tx-1",
        type: "payment",
        participants: ["customer-1", "merchant-1"],
        amount: 256,
        currency: "USD",
      });
      expect(creates[0].data.createdAt).toBeDefined();
    });
  });
});
