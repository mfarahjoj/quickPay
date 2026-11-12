/**
 * The probe that stands in for a customer trying to pay.
 *
 * `enforceAggregateLimits` fails closed, which is right, so one unservable
 * query takes every outbound flow down at once. These tests pin the two
 * things that make the probe worth having: it runs the *real* query, and it
 * reports a failure instead of throwing — a health check that throws just
 * moves the outage rather than reporting it.
 */

const aggregateGet = jest.fn();
const where = jest.fn();

jest.mock("firebase-admin", () => {
  const chain: any = {
    where: (...args: unknown[]) => {
      where(...args);
      return chain;
    },
    aggregate: () => ({ get: aggregateGet }),
  };
  const firestore: any = jest.fn(() => ({ collection: () => chain }));
  firestore.Timestamp = { fromDate: (d: Date) => ({ __date: d.toISOString() }) };
  return { firestore };
});

jest.mock("firebase-admin/firestore", () => ({
  AggregateField: { sum: (field: string) => ({ __sum: field }) },
}));

import { probeSpendIndex, startOfLocalMonth } from "../utils/limits";

beforeEach(() => {
  aggregateGet.mockReset();
  where.mockReset();
});

describe("probeSpendIndex", () => {
  it("reports ok when the aggregation runs", async () => {
    aggregateGet.mockResolvedValue({ data: () => ({ total: 0 }) });
    await expect(probeSpendIndex()).resolves.toEqual({ ok: true });
  });

  // The whole point: it exercises the same query shape the callables run, so
  // an index that stops covering one stops covering the other.
  it("runs the real spend query, not a simplified stand-in", async () => {
    aggregateGet.mockResolvedValue({ data: () => ({ total: 0 }) });
    const now = new Date("2026-09-27T12:00:00Z");
    await probeSpendIndex(now);

    expect(where.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["fromUserId", "=="],
      ["type", "in"],
      ["createdAt", ">="],
    ]);
    expect(where.mock.calls[2][2]).toEqual({
      __date: startOfLocalMonth(now).toISOString(),
    });
  });

  it("reads no real account's history", async () => {
    aggregateGet.mockResolvedValue({ data: () => ({ total: 0 }) });
    await probeSpendIndex();
    expect(where.mock.calls[0][2]).toBe("__spend_index_probe__");
  });

  // A missing index surfaces as FAILED_PRECONDITION here. The caller is a
  // health check, so it needs the message, not an exception.
  it("returns the failure rather than throwing it", async () => {
    aggregateGet.mockRejectedValue(
      new Error("9 FAILED_PRECONDITION: The query requires an index.")
    );
    await expect(probeSpendIndex()).resolves.toEqual({
      ok: false,
      error: "9 FAILED_PRECONDITION: The query requires an index.",
    });
  });
});
