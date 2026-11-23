import { describe, expect, it } from "vitest";
import { clockOffset, viewModel, type ViewInput } from "./viewModel";
import type { CounterDisplayState } from "../types";

const NOW = 1_700_000_000_000;

const base: CounterDisplayState = {
  v: 1,
  merchantName: "Hodan's Shop",
  idleQr: "IDLE-QR",
  mode: "idle",
  lang: "en",
  derivedAtMs: NOW - 1000,
};
const sale = { id: "q1", qrData: "SALE-QR", amountCents: 1250, currency: "USD" as const, createdAtMs: NOW - 10_000, expiresAtMs: NOW + 60_000 };
const request = { id: "r1", amountCents: 1250, currency: "USD" as const, customerFirstName: "Amina", createdAtMs: NOW - 5000, expiresAtMs: NOW + 30_000 };

function input(state: Partial<CounterDisplayState> | null, extra: Partial<ViewInput> = {}): ViewInput {
  return {
    state: state ? { ...base, ...state } : null,
    stateMissing: false,
    revoked: false,
    cachedIdle: null,
    nowMs: NOW,
    clockReady: true,
    ...extra,
  };
}

describe("viewModel", () => {
  it("state doc gone → unlinked", () => {
    expect(viewModel(input(base, { stateMissing: true })).screen).toBe("unlinked");
  });
  it("revoked → unlinked, even with a live sale", () => {
    expect(viewModel(input({ mode: "sale", sale }, { revoked: true })).screen).toBe("unlinked");
  });
  it("unavailable beats everything else", () => {
    const flash = { kind: "paid" as const, amountCents: 1, atMs: NOW, showUntilMs: NOW + 5000 };
    expect(viewModel(input({ mode: "unavailable", flash })).screen).toBe("unavailable");
  });
  it("flash while showUntil is ahead", () => {
    const flash = { kind: "paid" as const, amountCents: 1250, receiptNumber: "ZP-AAAA-BBBB", atMs: NOW - 1000, showUntilMs: NOW + 7000 };
    const v = viewModel(input({ mode: "sale", sale, flash }));
    expect(v.screen).toBe("flash");
  });
  it("flash ends exactly at showUntil", () => {
    const flash = { kind: "declined" as const, amountCents: 1250, atMs: NOW - 5000, showUntilMs: NOW };
    expect(viewModel(input({ flash })).screen).toBe("idle");
  });
  it("approving with a live request, with seconds left", () => {
    const v = viewModel(input({ mode: "approving", request }));
    expect(v).toMatchObject({ screen: "approving", secondsLeft: 30 });
  });
  it("approving falls back to idle once the request expires", () => {
    expect(viewModel(input({ mode: "approving", request }, { nowMs: request.expiresAtMs })).screen).toBe("idle");
  });
  it("sale with a live QR", () => {
    const v = viewModel(input({ mode: "sale", sale }, { nowMs: NOW + 500 }));
    expect(v).toMatchObject({ screen: "sale", secondsLeft: 60 });
  });
  it("countdown rounds up", () => {
    const v = viewModel(input({ mode: "sale", sale }, { nowMs: sale.expiresAtMs - 1 }));
    expect(v).toMatchObject({ screen: "sale", secondsLeft: 1 });
  });
  it("expired sale → idle My QR", () => {
    const v = viewModel(input({ mode: "sale", sale }, { nowMs: sale.expiresAtMs }));
    expect(v).toEqual({ screen: "idle", merchantName: "Hodan's Shop", idleQr: "IDLE-QR" });
  });
  it("sale mode without a sale → idle", () => {
    expect(viewModel(input({ mode: "sale" })).screen).toBe("idle");
  });
  it("no timed screen before the clock is set", () => {
    const flash = { kind: "paid" as const, amountCents: 1, atMs: NOW, showUntilMs: NOW + 5000 };
    expect(viewModel(input({ mode: "sale", sale, flash }, { clockReady: false })).screen).toBe("idle");
    expect(viewModel(input({ mode: "approving", request }, { clockReady: false })).screen).toBe("idle");
  });
  it("no state yet: cached idle if there is one, else loading", () => {
    expect(viewModel(input(null)).screen).toBe("loading");
    const cachedIdle = { merchantName: "Cached", idleQr: "CACHED-QR", lang: "so" as const };
    expect(viewModel(input(null, { cachedIdle }))).toEqual({ screen: "idle", merchantName: "Cached", idleQr: "CACHED-QR" });
  });
  it("judges expiry on the server-corrected clock", () => {
    // Tablet clock 2 minutes slow: local now is NOW - 120 s, server says NOW + 61 s.
    const local = NOW - 120_000;
    const offset = clockOffset(local, local + 200, NOW + 61_000 + 100);
    expect(viewModel(input({ mode: "sale", sale }, { nowMs: local + 200 + offset })).screen).toBe("idle");
  });
});

describe("clockOffset", () => {
  it("uses the midpoint of the round trip", () => {
    expect(clockOffset(1000, 1400, 6200)).toBe(5000);
  });
});
