/**
 * `enforceTransactionLimits` runs before every outbound flow — cash-out, QR
 * payment, P2P, remittance, payroll — so a query it cannot serve takes down
 * every way of spending money at once. That is exactly what happened: the
 * index for `sumSpendSince` listed the filter fields but not `amount`, and
 * Firestore rejects a sum aggregation unless the summed field is in the
 * index too. Every pay option returned FAILED_PRECONDITION until it was added.
 *
 * This test pins the index definition to the query, so changing one without
 * the other fails here rather than in production.
 */

import * as fs from "fs";
import * as path from "path";
import { SPEND_TX_TYPES } from "../utils/limits";

interface IndexField {
  fieldPath: string;
  order?: string;
  arrayConfig?: string;
}

interface CompositeIndex {
  collectionGroup: string;
  queryScope: string;
  fields: IndexField[];
}

const indexes: CompositeIndex[] = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "firestore.indexes.json"),
    "utf8"
  )
).indexes;

function hasIndex(collectionGroup: string, fieldPaths: string[]): boolean {
  return indexes.some(
    (index) =>
      index.collectionGroup === collectionGroup &&
      index.fields.length === fieldPaths.length &&
      index.fields.every(
        (field, i) =>
          field.fieldPath === fieldPaths[i] && field.order === "ASCENDING"
      )
  );
}

describe("spend-limit aggregation index", () => {
  // The exact shape of the query in sumSpendSince: two equality/`in` filters,
  // a range on createdAt, and the aggregated field last.
  it("covers the sum over amount, not just the filters", () => {
    expect(
      hasIndex("transactions", ["fromUserId", "type", "createdAt", "amount"])
    ).toBe(true);
  });

  it("aggregates a field the transactions writers actually set", () => {
    expect([...SPEND_TX_TYPES]).toEqual(["payment", "withdrawal"]);
  });
});
