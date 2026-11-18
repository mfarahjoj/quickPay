import { describe, expect, it } from "vitest";
import { niceTicks } from "./charts";

describe("niceTicks", () => {
  it("always reaches the max, in clean steps", () => {
    expect(niceTicks(17)).toEqual([0, 10, 20]);
    expect(niceTicks(15)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(2000)).toEqual([0, 1000, 2000]);
    expect(niceTicks(0)).toEqual([0]);
    for (const m of [1, 3, 7, 33, 99, 101, 4350, 98765]) expect(niceTicks(m).at(-1)!).toBeGreaterThanOrEqual(m);
  });
});
