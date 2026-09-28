/**
 * In-memory Firestore stand-in, rich enough to run the real ledger.
 *
 * Transactions stage their writes and apply them only if the callback
 * resolves, as real Firestore does, so a test can tell a write that commits
 * from one a throw rolls back. Supports the FieldValue transforms the code
 * under test uses (increment, delete) and the query shapes it runs.
 */

import * as admin from "firebase-admin";

type Data = Record<string, any>;

function applyTransforms(base: Data | undefined, patch: Data): Data {
  const out: Data = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    const kind = value?.constructor?.name;
    if (kind === "NumericIncrementTransform") {
      out[key] = (typeof out[key] === "number" ? out[key] : 0) + value.operand;
    } else if (kind === "DeleteTransform") {
      delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
}

const comparable = (v: any) => (v && typeof v.toMillis === "function" ? v.toMillis() : v);

function matches(doc: Data, field: string, op: string, value: any): boolean {
  const a = comparable(doc?.[field]);
  const b = comparable(value);
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    case "in": return (value as any[]).includes(a);
    default: throw new Error(`fakeFirestore: unsupported op ${op}`);
  }
}

export interface FakeDb {
  store: Map<string, Data>;
  get(path: string): Data | undefined;
  collection(name: string): any;
  runTransaction: jest.Mock;
}

export function fakeFirestore(seed: Record<string, Data> = {}): FakeDb {
  const store = new Map<string, Data>(Object.entries(seed));
  let auto = 0;

  const snap = (path: string) => ({
    exists: store.has(path),
    id: path.split("/").pop()!,
    ref: ref(path.split("/").slice(0, -1).join("/"), path.split("/").pop()),
    data: () => (store.has(path) ? { ...store.get(path) } : undefined),
  });

  const write = {
    set: (path: string, d: Data, opts?: { merge?: boolean }) =>
      store.set(path, applyTransforms(opts?.merge ? store.get(path) : undefined, d)),
    create: (path: string, d: Data) => {
      if (store.has(path)) throw new Error(`ALREADY_EXISTS ${path}`);
      store.set(path, applyTransforms(undefined, d));
    },
    update: (path: string, d: Data) => {
      if (!store.has(path)) throw new Error(`NOT_FOUND ${path}`);
      store.set(path, applyTransforms(store.get(path), d));
    },
  };

  function ref(col: string, id?: string): any {
    const docId = id ?? `auto${++auto}`;
    const path = `${col}/${docId}`;
    return {
      id: docId,
      path,
      get: async () => snap(path),
      set: async (d: Data, opts?: { merge?: boolean }) => write.set(path, d, opts),
      create: async (d: Data) => write.create(path, d),
      update: async (d: Data) => write.update(path, d),
      collection: (sub: string) => collection(`${path}/${sub}`),
    };
  }

  interface QState {
    filters: Array<[string, string, any]>;
    order?: [string, "asc" | "desc"];
    max: number;
    after?: string;
  }

  function query(col: string, s: QState): any {
    const run = () => {
      const depth = col.split("/").length + 1;
      let rows = [...store.entries()].filter(
        ([p, d]) =>
          p.startsWith(`${col}/`) &&
          p.split("/").length === depth &&
          s.filters.every(([f, op, v]) => matches(d, f, op, v))
      );
      if (s.order) {
        const [f, dir] = s.order;
        rows.sort(([, x], [, y]) => {
          const a = comparable(x[f]);
          const b = comparable(y[f]);
          return (a < b ? -1 : a > b ? 1 : 0) * (dir === "desc" ? -1 : 1);
        });
      }
      if (s.after) {
        const i = rows.findIndex(([p]) => p === s.after);
        rows = i >= 0 ? rows.slice(i + 1) : rows;
      }
      return rows.slice(0, s.max).map(([p]) => snap(p));
    };
    return {
      where: (f: string, op: string, v: any) => query(col, { ...s, filters: [...s.filters, [f, op, v]] }),
      orderBy: (f: string, dir: "asc" | "desc" = "asc") => query(col, { ...s, order: [f, dir] }),
      limit: (n: number) => query(col, { ...s, max: n }),
      startAfter: (cursor: any) => query(col, { ...s, after: `${col}/${cursor.id}` }),
      count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
      get: async () => {
        const docs = run();
        return { empty: docs.length === 0, size: docs.length, docs };
      },
    };
  }

  function collection(name: string): any {
    return {
      doc: (id?: string) => ref(name, id),
      ...query(name, { filters: [], max: Infinity }),
    };
  }

  const runTransaction = jest.fn(async (fn: (tx: any) => Promise<any>) => {
    const staged: Array<() => void> = [];
    const tx = {
      get: async (r: any) => (typeof r.get === "function" && !r.path ? r.get() : snap(r.path)),
      set: (r: any, d: Data, opts?: { merge?: boolean }) => staged.push(() => write.set(r.path, d, opts)),
      create: (r: any, d: Data) => staged.push(() => write.create(r.path, d)),
      update: (r: any, d: Data) => staged.push(() => write.update(r.path, d)),
    };
    const result = await fn(tx);
    staged.forEach((w) => w());
    return result;
  });

  return {
    store,
    get: (path: string) => store.get(path),
    collection,
    runTransaction,
  };
}

/** Point admin.firestore() at a fake, keeping the static helpers. Returns a restore fn. */
export function useFakeFirestore(db: FakeDb): () => void {
  const { Timestamp, FieldValue, FieldPath } = admin.firestore;
  const spy = jest.spyOn(admin, "firestore").mockReturnValue(db as any);
  Object.assign(admin.firestore, { Timestamp, FieldValue, FieldPath });
  return () => spy.mockRestore();
}

/** A wallet doc as setupPin creates it. */
export function wallet(balance: number, extra: Data = {}): Data {
  return {
    balance,
    currency: "USD",
    totalReceived: 0,
    totalSent: 0,
    lastTransactionAt: null,
    updatedAt: admin.firestore.Timestamp.now(),
    ...extra,
  };
}
