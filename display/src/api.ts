/** Typed wrappers for the tablet's callables (functions/src/counterDisplay/). */
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { DisplayCreds } from "./types";

interface Envelope<T> {
  success: boolean;
  data: T;
}

async function call<I, O>(name: string, input: I, timeout = 15000): Promise<O> {
  const fn = httpsCallable<I, Envelope<O>>(functions, name, { timeout });
  const res = await fn(input);
  return res.data.data;
}

export interface StartPairing {
  pairingId: string;
  pairingSecret: string;
  code: string;
  expiresAtMs: number;
  serverNowMs: number;
}
export const startDisplayPairing = () => call<Record<string, never>, StartPairing>("startDisplayPairing", {});

export interface PollPairing {
  status: "waiting" | "claimed" | "completed" | "declined" | "expired";
  merchantName: string | null;
  expiresAtMs: number;
  serverNowMs: number;
}
export const pollDisplayPairing = (pairingId: string, pairingSecret: string) =>
  call<object, PollPairing>("pollDisplayPairing", { pairingId, pairingSecret });

export interface ConfirmPairing {
  status: "completed" | "declined";
  displayId?: string;
  displaySecret?: string;
  stateKey?: string;
  merchantName?: string | null;
  serverNowMs?: number;
}
export const confirmDisplayPairing = (pairingId: string, pairingSecret: string, accept: boolean) =>
  call<object, ConfirmPairing>("confirmDisplayPairing", { pairingId, pairingSecret, accept });

export interface Heartbeat {
  serverNowMs: number;
  latestBuild: string | null;
}
export const displayHeartbeat = (creds: DisplayCreds, appBuild: string, lastError?: string | null) =>
  call<object, Heartbeat>(
    "displayHeartbeat",
    { displayId: creds.displayId, secret: creds.displaySecret, appBuild, ...(lastError ? { lastError } : {}) },
    10000
  );

export interface ScanResult {
  requestId: string;
  amountCents: number;
  customerFirstName: string;
  expiresAtMs: number;
}
/** Sends the sale the tablet is showing and the scanned code. Never an amount. */
export const displayScanCustomer = (creds: DisplayCreds, saleId: string, tokenData: string) =>
  call<object, ScanResult>("displayScanCustomer", {
    displayId: creds.displayId,
    secret: creds.displaySecret,
    saleId,
    tokenData,
  });

export const displaySignOut = (creds: DisplayCreds) =>
  call<object, { unlinked: boolean }>("displaySignOut", { displayId: creds.displayId, secret: creds.displaySecret });

/** The `reason` a display callable put in its HttpsError details, if any. */
export function errorReason(err: unknown): string | null {
  const details = (err as { details?: { reason?: unknown } })?.details;
  return typeof details?.reason === "string" ? details.reason : null;
}
