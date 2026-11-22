import { eraseAccount, findDeletionBlockers } from "../auth/accountDeletion";

/**
 * A just-enough in-memory Firestore: documents live at "collection/id"
 * (subcollections at "collection/id/sub/id"), queries support chained
 * `where(==)` and `limit`.
 */
class FakeDb {
  docs = new Map<string, Record<string, any>>();

  seed(path: string, data: Record<string, any>) {
    this.docs.set(path, { ...data });
  }

  collection(name: string): any {
    return this.col(name);
  }

  private col(path: string): any {
    const db = this;
    const makeQuery = (
      filters: Array<[string, any]>,
      max: number
    ): any => ({
      where: (f: string, _op: string, v: any) =>
        makeQuery([...filters, [f, v]], max),
      limit: (n: number) => makeQuery(filters, n),
      get: async () => {
        const docs = [...db.docs.entries()]
          .filter(([p, d]) => {
            if (!p.startsWith(path + "/")) return false;
            if (p.slice(path.length + 1).includes("/")) return false;
            return filters.every(([f, v]) => d[f] === v);
          })
          .slice(0, max)
          .map(([p]) => db.snap(p));
        return { empty: docs.length === 0, size: docs.length, docs };
      },
    });
    return {
      path,
      doc: (id: string) => db.ref(`${path}/${id}`),
      ...makeQuery([], Infinity),
    };
  }

  snap(path: string): any {
    const data = this.docs.get(path);
    return {
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined),
      ref: this.ref(path),
    };
  }

  ref(path: string): any {
    const db = this;
    return {
      path,
      get: async () => db.snap(path),
      set: async (d: any) => void db.docs.set(path, { ...d }),
      update: async (d: any) =>
        void db.docs.set(path, { ...db.docs.get(path), ...d }),
      delete: async () => void db.docs.delete(path),
      collection: (sub: string) => db.col(`${path}/${sub}`),
      listCollections: async () => {
        const subs = new Set<string>();
        for (const p of db.docs.keys()) {
          if (p.startsWith(path + "/")) {
            subs.add(p.slice(path.length + 1).split("/")[0]);
          }
        }
        return [...subs].map((s) => db.col(`${path}/${s}`));
      },
    };
  }

  batch() {
    const ops: Array<() => void> = [];
    return {
      delete: (ref: any) => void ops.push(() => this.docs.delete(ref.path)),
      commit: async () => ops.forEach((o) => o()),
    };
  }

  async runTransaction(fn: (tx: any) => Promise<void>) {
    const writes: Array<() => void> = [];
    const tx = {
      get: async (ref: any) => this.snap(ref.path),
      update: (ref: any, d: any) =>
        void writes.push(() =>
          this.docs.set(ref.path, { ...this.docs.get(ref.path), ...d })
        ),
    };
    await fn(tx);
    writes.forEach((w) => w());
  }

  async recursiveDelete(col: any) {
    for (const p of [...this.docs.keys()]) {
      if (p.startsWith(col.path + "/")) this.docs.delete(p);
    }
  }
}

const UID = "u1";
const T = (s: string) => s as any;

function seedCustomer(db: FakeDb) {
  db.seed(`users/${UID}`, {
    accountType: "customer",
    fullName: "Amina Yusuf",
    phoneNumber: "+252630000000",
    pinHash: "hash",
    address: { city: "Hargeisa" },
    referralCode: "ABC123",
    createdAt: "t0",
  });
  db.seed(`users/${UID}/kyc/latest`, { frontUrl: "x" });
  db.seed(`users/${UID}/fcmTokens/a`, { token: "tok" });
  db.seed(`wallets/${UID}`, { balance: 0, currency: "USD", totalSent: 500 });
  db.seed("notifications/n1", { userId: UID });
  db.seed("notifications/n2", { userId: "someone-else" });
  db.seed("trustedDevices/d1", { uid: UID });
  db.seed("customerTokens/c1", { customerId: UID });
  db.seed("transactions/t1", { participants: [UID, "other"], amount: 500 });
}

function deps(db: FakeDb, over: Record<string, any> = {}) {
  const files: string[] = [];
  const deletedAuth: string[] = [];
  return {
    files,
    deletedAuth,
    d: {
      db: db as any,
      deleteFiles: async (p: string) => void files.push(p),
      deleteAuthUser: async (u: string) => void deletedAuth.push(u),
      now: () => T("now"),
      ...over,
    },
  };
}

describe("findDeletionBlockers", () => {
  it("is empty for a settled customer", async () => {
    const db = new FakeDb();
    seedCustomer(db);
    expect(await findDeletionBlockers(db as any, UID, {}, 0)).toEqual([]);
  });

  it("blocks on any balance", async () => {
    const db = new FakeDb();
    expect(await findDeletionBlockers(db as any, UID, {}, 100)).toContain(
      "balance"
    );
  });

  it("blocks a frozen account but not a closed one", async () => {
    const db = new FakeDb();
    expect(
      await findDeletionBlockers(db as any, UID, { accountStatus: "frozen" }, 0)
    ).toContain("frozen");
    expect(
      await findDeletionBlockers(db as any, UID, { accountStatus: "closed" }, 0)
    ).toEqual([]);
  });

  it("blocks on a pending cash-out even with a zero wallet", async () => {
    const db = new FakeDb();
    db.seed("cashOutRequests/c1", { customerId: UID, status: "pending" });
    expect(await findDeletionBlockers(db as any, UID, {}, 0)).toEqual([
      "pending_cash_out",
    ]);
  });

  it("ignores finished requests and other people's", async () => {
    const db = new FakeDb();
    db.seed("cashOutRequests/c1", { customerId: UID, status: "completed" });
    db.seed("cashOutRequests/c2", { customerId: "x", status: "pending" });
    expect(await findDeletionBlockers(db as any, UID, {}, 0)).toEqual([]);
  });

  it("blocks a merchant with a pending payment request", async () => {
    const db = new FakeDb();
    db.seed("paymentRequests/p1", { merchantId: UID, status: "pending" });
    expect(await findDeletionBlockers(db as any, UID, {}, 0)).toEqual([
      "pending_payment",
    ]);
  });
});

describe("eraseAccount", () => {
  it("removes personal data and the login, and keeps the money trail", async () => {
    const db = new FakeDb();
    seedCustomer(db);
    const { d, files, deletedAuth } = deps(db);

    await eraseAccount(d, UID);

    expect(db.docs.has(`users/${UID}/kyc/latest`)).toBe(false);
    expect(db.docs.has(`users/${UID}/fcmTokens/a`)).toBe(false);
    expect(db.docs.has("notifications/n1")).toBe(false);
    expect(db.docs.has("trustedDevices/d1")).toBe(false);
    expect(db.docs.has("customerTokens/c1")).toBe(false);
    // someone else's data is untouched
    expect(db.docs.has("notifications/n2")).toBe(true);
    // the money trail stays
    expect(db.docs.has("transactions/t1")).toBe(true);
    expect(db.docs.get(`wallets/${UID}`)).toMatchObject({
      balance: 0,
      totalSent: 500,
      frozen: true,
    });
    expect(files).toEqual([`kyc/${UID}/`, `profiles/${UID}/`]);
    expect(deletedAuth).toEqual([UID]);
  });

  it("leaves only a tombstone for the user document", async () => {
    const db = new FakeDb();
    seedCustomer(db);
    await eraseAccount(deps(db).d, UID);

    const user = db.docs.get(`users/${UID}`)!;
    expect(user).toEqual({
      accountType: "customer",
      accountStatus: "closed",
      isActive: false,
      fullName: "Deleted user",
      phoneNumber: "",
      deletedAt: "now",
      createdAt: "t0",
    });
    for (const gone of ["pinHash", "address", "referralCode", "email"]) {
      expect(user).not.toHaveProperty(gone);
    }
  });

  it("stubs a merchant profile instead of deleting it, and removes QR codes", async () => {
    const db = new FakeDb();
    seedCustomer(db);
    db.seed(`merchantProfiles/${UID}`, {
      businessName: "Hargeisa Electronics",
      businessAddress: "Main St",
      zaadAccount: "063000000",
    });
    db.seed("qrCodes/q1", { merchantId: UID });
    await eraseAccount(deps(db).d, UID);

    expect(db.docs.get(`merchantProfiles/${UID}`)).toMatchObject({
      businessName: "Closed business",
    });
    expect(db.docs.get(`merchantProfiles/${UID}`)).not.toHaveProperty(
      "zaadAccount"
    );
    expect(db.docs.has("qrCodes/q1")).toBe(false);
  });

  it("refuses, changing nothing, if the balance moved after the check", async () => {
    const db = new FakeDb();
    seedCustomer(db);
    db.seed(`wallets/${UID}`, { balance: 250, currency: "USD" });
    const { d, deletedAuth } = deps(db);

    await expect(eraseAccount(d, UID)).rejects.toThrow("balance-changed");
    expect(db.docs.get(`users/${UID}`)).toMatchObject({
      fullName: "Amina Yusuf",
    });
    expect(deletedAuth).toEqual([]);
  });

  it("keeps the login if erasing fails part-way, so it can be retried", async () => {
    const db = new FakeDb();
    seedCustomer(db);
    const { d, deletedAuth } = deps(db, {
      deleteFiles: async () => {
        throw new Error("storage down");
      },
    });
    await expect(eraseAccount(d, UID)).rejects.toThrow("storage down");
    expect(deletedAuth).toEqual([]);
  });

  it("can be run again over its own result", async () => {
    const db = new FakeDb();
    seedCustomer(db);
    await eraseAccount(deps(db).d, UID);
    const again = deps(db);
    await eraseAccount(again.d, UID);
    expect(again.deletedAuth).toEqual([UID]);
    expect(db.docs.get(`users/${UID}`)).toMatchObject({
      fullName: "Deleted user",
    });
  });
});
