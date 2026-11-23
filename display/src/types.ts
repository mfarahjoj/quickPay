/** Mirror of functions/src/counterDisplay/types.ts: the state doc as the tablet reads it. */

export type DisplayMode = "idle" | "sale" | "approving" | "unavailable";
export type Lang = "en" | "so" | "ar";

export interface StateSale {
  id: string;
  qrData: string;
  /** In the currency's smallest unit: cents, or whole shillings. */
  amountCents: number;
  currency: "USD" | "SLS";
  reference?: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface StateRequest {
  id: string;
  /** In the currency's smallest unit: cents, or whole shillings. */
  amountCents: number;
  currency: "USD" | "SLS";
  customerFirstName: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface StateFlash {
  kind: "paid" | "declined" | "expired";
  amountCents: number;
  /** Absent from servers before shillings: dollars. */
  currency?: "USD" | "SLS";
  receiptNumber?: string;
  atMs: number;
  showUntilMs: number;
}

export interface CounterDisplayState {
  v: 1;
  merchantName: string;
  idleQr: string;
  mode: DisplayMode;
  sale?: StateSale;
  request?: StateRequest;
  flash?: StateFlash;
  lang: Lang;
  derivedAtMs: number;
}

/** What the tablet keeps after pairing. */
export interface DisplayCreds {
  displayId: string;
  displaySecret: string;
  stateKey: string;
}

declare global {
  const __DISPLAY_BUILD__: string;
}
