import { DEFAULT_LIMITS, tierFor } from "../config/limits";
import {
  SPEND_TX_TYPES,
  startOfLocalDay,
  startOfLocalMonth,
  describeLimits,
} from "../utils/limits";

describe("tierFor", () => {
  it("puts unverified accounts on the entry tier", () => {
    expect(tierFor("pending", "customer")).toBe("unverified");
    expect(tierFor("submitted", "customer")).toBe("unverified");
    expect(tierFor(undefined, undefined)).toBe("unverified");
  });

  it("treats a rejected document as its own, tighter tier", () => {
    expect(tierFor("rejected", "customer")).toBe("rejected");
    expect(DEFAULT_LIMITS.rejected.perTransaction).toBeLessThan(
      DEFAULT_LIMITS.unverified.perTransaction
    );
    expect(DEFAULT_LIMITS.rejected.daily).toBeLessThan(DEFAULT_LIMITS.unverified.daily);
  });

  it("raises verified consumers", () => {
    expect(tierFor("verified", "customer")).toBe("verified");
  });

  it("gives businesses their own tiers once verified", () => {
    expect(tierFor("verified", "merchant")).toBe("merchant");
    expect(tierFor("verified", "topup_agent")).toBe("agent");
    expect(tierFor("verified", "agent_merchant")).toBe("agent");
  });

  // The elevated tiers exist because businesses move more money — which is
  // exactly why holding the role must not be enough on its own.
  it("does not grant business limits to an unverified business account", () => {
    expect(tierFor("pending", "merchant")).toBe("unverified");
    expect(tierFor("submitted", "topup_agent")).toBe("unverified");
    expect(tierFor("rejected", "agent_merchant")).toBe("rejected");
  });
});

describe("DEFAULT_LIMITS", () => {
  it("is ordered from tightest to loosest", () => {
    const daily = (t: keyof typeof DEFAULT_LIMITS) => DEFAULT_LIMITS[t].daily;
    expect(daily("rejected")).toBeLessThan(daily("unverified"));
    expect(daily("unverified")).toBeLessThan(daily("verified"));
    expect(daily("verified")).toBeLessThan(daily("merchant"));
    expect(daily("merchant")).toBeLessThan(daily("agent"));
  });

  it("keeps every limit a whole number of cents", () => {
    for (const tier of Object.values(DEFAULT_LIMITS)) {
      expect(Number.isInteger(tier.perTransaction)).toBe(true);
      expect(Number.isInteger(tier.daily)).toBe(true);
      expect(Number.isInteger(tier.monthly)).toBe(true);
    }
  });

  it("never lets a single transaction exceed the daily cap", () => {
    for (const [name, tier] of Object.entries(DEFAULT_LIMITS)) {
      expect(`${name}:${tier.perTransaction <= tier.daily}`).toBe(`${name}:true`);
      expect(tier.daily).toBeLessThanOrEqual(tier.monthly);
    }
  });
});

describe("SPEND_TX_TYPES", () => {
  // A mobile-money top-up and a mobile-money cash-out both write
  // fromUserId === toUserId === userId, so counting spend by sender alone
  // would make topping up consume your own daily limit.
  it("counts payments and withdrawals only", () => {
    expect([...SPEND_TX_TYPES]).toEqual(["payment", "withdrawal"]);
  });

  it("excludes inbound and reversal types", () => {
    for (const type of ["topup", "referral", "refund"]) {
      expect((SPEND_TX_TYPES as readonly string[]).includes(type)).toBe(false);
    }
  });
});

describe("local day and month boundaries", () => {
  // Cloud Functions run in UTC; Somaliland is UTC+3. Without the offset,
  // "today" would roll over at 3am local.
  const OFFSET_MS = 3 * 3600 * 1000;

  it("starts the day at local midnight", () => {
    // 2026-08-05T00:30:00Z is 03:30 on the 5th locally — same local day.
    const start = startOfLocalDay(new Date("2026-08-05T00:30:00Z"));
    expect(start.toISOString()).toBe("2026-08-04T21:00:00.000Z");
  });

  it("puts a late local evening in the local day, not the next UTC one", () => {
    // 2026-08-05T22:00:00Z is 01:00 on the 6th locally.
    const start = startOfLocalDay(new Date("2026-08-05T22:00:00Z"));
    expect(start.toISOString()).toBe("2026-08-05T21:00:00.000Z");
  });

  it("is always exactly local midnight", () => {
    for (const iso of [
      "2026-01-01T00:00:00Z",
      "2026-06-15T11:59:59Z",
      "2026-12-31T23:59:59Z",
    ]) {
      const start = startOfLocalDay(new Date(iso));
      const local = new Date(start.getTime() + OFFSET_MS);
      expect(local.getUTCHours()).toBe(0);
      expect(local.getUTCMinutes()).toBe(0);
      expect(local.getUTCSeconds()).toBe(0);
    }
  });

  it("starts the month on the first, local time", () => {
    const start = startOfLocalMonth(new Date("2026-08-05T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-07-31T21:00:00.000Z");
    const local = new Date(start.getTime() + OFFSET_MS);
    expect(local.getUTCDate()).toBe(1);
    expect(local.getUTCMonth()).toBe(7); // August
  });

  it("never starts the day after now", () => {
    const now = new Date("2026-08-05T00:10:00Z");
    expect(startOfLocalDay(now).getTime()).toBeLessThanOrEqual(now.getTime());
    expect(startOfLocalMonth(now).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe("describeLimits", () => {
  it("reports remaining in dollars and never goes negative", () => {
    const out = describeLimits(
      { perTransaction: 100000, daily: 500000, monthly: 5000000 },
      { dailyUsed: 600000, monthlyUsed: 100000 }
    );
    expect(out.dailyLimit).toBe(5000);
    expect(out.dailyUsed).toBe(6000);
    // Overshoot (limits are checked before, not during, a race) must not show
    // as a negative allowance.
    expect(out.dailyRemaining).toBe(0);
    expect(out.monthlyRemaining).toBe(49000);
    expect(out.perTransactionLimit).toBe(1000);
  });
});
