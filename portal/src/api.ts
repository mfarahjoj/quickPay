/**
 * The portal callables (functions/src/portal/) and the live listeners on the
 * shop's insights docs (functions/src/merchantStats/).
 */
import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db, functions } from "./firebase";
import type { CustomerRow, CustomerSale, CustomerView, Currency, DayStats, PortalStore, RecentItem, TxRow } from "./lib/types";

async function call<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  const res = await httpsCallable(functions, name)(data);
  return (res.data as { data: T }).data;
}

export interface LoginStart {
  loginId: string;
  code: string;
  pollSecret: string;
  expiresAtMs: number;
  serverNowMs: number;
}

export type LoginPoll =
  | { status: "waiting" | "expired" | "declined"; expiresAtMs: number }
  | { status: "approved"; token: string; merchantName: string | null; sessionExpiresAtMs: number };

export const startLogin = () => call<LoginStart>("startPortalLogin");
export const pollLogin = (loginId: string, pollSecret: string) => call<LoginPoll>("pollPortalLogin", { loginId, pollSecret });
export const signOutSession = () => call<{ ended: number }>("revokePortalSession");

export const getStore = () => call<PortalStore>("portalGetStore");
export const inviteStore = (phone: string) => call<{ storeUid: string; storeName: string }>("portalInviteStore", { phone });
export const respondLink = (accept: boolean) => call<{ status: string }>("portalRespondLink", { accept });
export const unlinkStore = (storeUid?: string) => call<{ unlinked: string }>("portalUnlinkStore", storeUid ? { storeUid } : {});
export const getCustomers = (storeUid: string, view: CustomerView, currency: Currency, limit = 20) =>
  call<{ customers: CustomerRow[]; today: string }>("portalGetCustomers", { storeUid, view, currency, limit });
export const getCustomer = (storeUid: string, customerUid: string) =>
  call<{ customer: CustomerRow; sales: CustomerSale[] }>("portalGetCustomer", { storeUid, customerUid });
export const listTransactions = (storeUid: string, cursor?: number | null) =>
  call<{ transactions: TxRow[]; nextCursor: number | null }>("portalListTransactions", { storeUid, cursor: cursor ?? undefined, limit: 50 });
export const exportStatement = (storeUid: string, fromMs: number, toMs: number) =>
  call<{ csv: string; truncated: boolean }>("portalExportStatement", { storeUid, fromMs, toMs });

/** The shop's day docs from `fromDay` on, live. */
export function watchDays(storeUid: string, fromDay: string, onData: (days: DayStats[]) => void, onError: (e: Error) => void): Unsubscribe {
  const q = query(collection(db, "merchantStats", storeUid, "days"), where(documentId(), ">=", fromDay));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as DayStats)),
    onError
  );
}

/** The last sales and refunds, live. */
export function watchRecent(storeUid: string, onData: (items: RecentItem[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    doc(db, "merchantStats", storeUid, "live", "recent"),
    (snap) => onData(((snap.data()?.items as RecentItem[] | undefined) ?? []).slice()),
    onError
  );
}

/** Distinct customers since `sinceMs`: everyone whose last visit is in the window. */
export async function countCustomersSince(storeUid: string, sinceMs: number): Promise<number> {
  const q = query(collection(db, "merchantStats", storeUid, "customers"), where("lastSeenAtMs", ">=", sinceMs));
  return (await getCountFromServer(q)).data().count;
}

/** True when a portal error means the session is over: sign out and show the QR again. */
export function isSessionEnded(err: unknown): boolean {
  const e = err as { code?: string; details?: { reason?: string } };
  return (
    e?.details?.reason === "portal_session_ended" ||
    e?.details?.reason === "portal_signin_required" ||
    e?.code === "functions/unauthenticated" ||
    e?.code === "permission-denied"
  );
}
