/**
 * Decides what the counter shows. Pure, so every row of the plan's table
 * (COUNTER_DISPLAY_PLAN.md 7.2) is a unit test. Pairing and ConfirmLink are
 * decided before this, by whether the tablet has credentials.
 *
 * `nowMs` is the server-corrected clock. Until the first heartbeat has set it
 * (`clockReady`), no timed screen is shown: a tablet with a wrong clock could
 * otherwise show an expired sale as live, or a live one as expired.
 */
import type { CachedIdle } from "../storage";
import type { CounterDisplayState, StateFlash, StateRequest, StateSale } from "../types";

export type Screen =
  | { screen: "loading" }
  | { screen: "unlinked" }
  | { screen: "unavailable"; merchantName: string }
  | { screen: "flash"; merchantName: string; flash: StateFlash }
  | { screen: "approving"; merchantName: string; request: StateRequest; secondsLeft: number }
  | { screen: "sale"; merchantName: string; sale: StateSale; secondsLeft: number }
  | { screen: "idle"; merchantName: string; idleQr: string };

export interface ViewInput {
  state: CounterDisplayState | null;
  /** The server confirmed the state doc is gone (not a cache miss). */
  stateMissing: boolean;
  /** A display callable said `display_revoked`. */
  revoked: boolean;
  cachedIdle: CachedIdle | null;
  nowMs: number;
  clockReady: boolean;
}

const secondsLeft = (untilMs: number, nowMs: number) => Math.max(0, Math.ceil((untilMs - nowMs) / 1000));

export function viewModel(input: ViewInput): Screen {
  const { state, nowMs, clockReady } = input;
  if (input.stateMissing || input.revoked) return { screen: "unlinked" };

  if (!state) {
    if (input.cachedIdle) {
      return { screen: "idle", merchantName: input.cachedIdle.merchantName, idleQr: input.cachedIdle.idleQr };
    }
    return { screen: "loading" };
  }

  const merchantName = state.merchantName;
  if (state.mode === "unavailable") return { screen: "unavailable", merchantName };

  if (clockReady) {
    if (state.flash && nowMs < state.flash.showUntilMs) {
      return { screen: "flash", merchantName, flash: state.flash };
    }
    if (state.mode === "approving" && state.request && nowMs < state.request.expiresAtMs) {
      return {
        screen: "approving",
        merchantName,
        request: state.request,
        secondsLeft: secondsLeft(state.request.expiresAtMs, nowMs),
      };
    }
    if (state.mode === "sale" && state.sale && nowMs < state.sale.expiresAtMs) {
      return { screen: "sale", merchantName, sale: state.sale, secondsLeft: secondsLeft(state.sale.expiresAtMs, nowMs) };
    }
  }

  return { screen: "idle", merchantName, idleQr: state.idleQr };
}

/** offset = serverNow − midpoint of the round trip. */
export function clockOffset(sentAtMs: number, receivedAtMs: number, serverNowMs: number): number {
  return serverNowMs - (sentAtMs + receivedAtMs) / 2;
}
