import { firestore, functions } from './firebase.config';

/**
 * Staff access (STAFF_ACCESS.md). A shop adds people by phone number and
 * picks a role. They sign in to this app with their own Zapp account and PIN
 * and work for the shop in staff mode. The server checks the grant on every
 * call, so a removal takes effect at once.
 */

export type StaffRole = 'waiter' | 'cashier' | 'manager';
export type StaffStatus = 'invited' | 'active' | 'declined' | 'revoked' | 'left';

export interface StaffGrant {
  grantId: string;
  merchantUid: string;
  staffUid: string;
  role: StaffRole;
  status: StaffStatus;
  showCustomers: boolean;
  /**
   * Manager refund caps in US cents (shillings count at the shop's rate).
   * Both above zero means refunds are on; 0 means off.
   */
  refundCapCents: number;
  refundDayCapCents: number;
  shopName: string;
  staffName: string;
  staffPhone: string;
}

export const STAFF_ROLES: StaffRole[] = ['waiter', 'cashier', 'manager'];

/** What each role can do in this app. Mirrors functions/src/staff/types.ts. */
export function roleCanCharge(role: StaffRole): boolean {
  return role === 'cashier' || role === 'manager';
}
export function roleCanUsePortal(role: StaffRole): boolean {
  return role === 'manager';
}
export function roleCanRefund(role: StaffRole): boolean {
  return role === 'manager';
}
/** Whether the shop has turned refunds on for this grant. */
export function refundsOn(g: Pick<StaffGrant, 'role' | 'refundCapCents' | 'refundDayCapCents'>): boolean {
  return g.role === 'manager' && g.refundCapCents > 0 && g.refundDayCapCents > 0;
}

// ─── Acting for a shop ─────────────────────────────────────────────────────
//
// In staff mode every shop call names the shop it's for. scan.service and
// portal.service add this to their payloads; the shop's own account never
// sets it, so its calls are unchanged.

let actingForShop: string | null = null;

export function setActingFor(merchantUid: string | null): void {
  actingForShop = merchantUid;
}

/** `{ merchantId }` while working for a shop as staff, otherwise nothing. */
export function actingFor(): { merchantId?: string } {
  return actingForShop ? { merchantId: actingForShop } : {};
}

// ─── Live lists ────────────────────────────────────────────────────────────

function toGrant(doc: { id: string; data: () => any }): StaffGrant {
  const d = doc.data() ?? {};
  return {
    grantId: doc.id,
    merchantUid: d.merchantUid,
    staffUid: d.staffUid,
    role: d.role,
    status: d.status,
    showCustomers: d.showCustomers === true,
    refundCapCents: typeof d.refundCapCents === 'number' ? d.refundCapCents : 0,
    refundDayCapCents: typeof d.refundDayCapCents === 'number' ? d.refundDayCapCents : 0,
    shopName: d.shopName ?? '',
    staffName: d.staffName ?? '',
    staffPhone: d.staffPhone ?? '',
  };
}

const OPEN: StaffStatus[] = ['invited', 'active'];

/** The shop's staff list, invited and active. */
export function watchShopStaff(
  merchantUid: string,
  onChange: (grants: StaffGrant[]) => void,
  onError: (err: unknown) => void
): () => void {
  return firestore()
    .collection('merchantStaff')
    .where('merchantUid', '==', merchantUid)
    .where('status', 'in', OPEN)
    .onSnapshot(
      (snap) => onChange(snap.docs.map(toGrant).sort((a, b) => a.staffName.localeCompare(b.staffName))),
      onError
    );
}

/** The shops this person works for, or has been invited to. */
export function watchMyGrants(
  staffUid: string,
  onChange: (grants: StaffGrant[]) => void,
  onError: (err: unknown) => void,
  /** The shop took this grant away (not the person leaving or declining). */
  onRemovedByShop?: (grant: StaffGrant) => void
): () => void {
  return firestore()
    .collection('merchantStaff')
    .where('staffUid', '==', staffUid)
    .where('status', 'in', OPEN)
    .onSnapshot((snap) => {
      onChange(snap.docs.map(toGrant).sort((a, b) => a.shopName.localeCompare(b.shopName)));
      if (!onRemovedByShop) return;
      // A grant leaving this query says only that it's no longer open: look
      // once to tell the shop removing it from the person leaving or declining.
      for (const change of snap.docChanges()) {
        if (change.type !== 'removed') continue;
        const before = toGrant(change.doc);
        change.doc.ref
          .get()
          .then((now) => {
            if (now.data()?.status === 'revoked') onRemovedByShop(before);
          })
          .catch(() => {});
      }
    }, onError);
}

// ─── Shop: manage ──────────────────────────────────────────────────────────
//
// Errors are rethrown untouched so screens can map `details.reason`.

export async function inviteStaff(phone: string, role: StaffRole, showCustomers: boolean, pin: string): Promise<StaffGrant> {
  const result = await functions().httpsCallable('staffInvite')({ phone, role, showCustomers, pin });
  return (result.data as { data: StaffGrant }).data;
}

/** Refund caps in US cents; both 0 turns a manager's refunds off. */
export interface RefundCaps {
  refundCapCents: number;
  refundDayCapCents: number;
}

export async function updateStaff(
  staffUid: string,
  role: StaffRole,
  showCustomers: boolean,
  pin: string,
  caps: RefundCaps = { refundCapCents: 0, refundDayCapCents: 0 }
): Promise<void> {
  await functions().httpsCallable('staffUpdate')({ staffUid, role, showCustomers, pin, ...caps });
}

export async function removeStaff(staffUid: string): Promise<void> {
  await functions().httpsCallable('staffRemove')({ staffUid });
}

// ─── Staff: respond, leave ─────────────────────────────────────────────────

export async function respondToInvite(merchantId: string, accept: boolean): Promise<void> {
  await functions().httpsCallable('staffRespond')({ merchantId, accept });
}

export async function leaveShop(merchantId: string): Promise<void> {
  await functions().httpsCallable('staffLeave')({ merchantId });
}

// ─── Manager: payments and refunds ─────────────────────────────────────────

export interface StaffPayment {
  id: string;
  currency: 'USD' | 'SLS';
  /** In the currency's smallest unit: cents, or whole shillings. */
  amount: number;
  refunded: number;
  remaining: number;
  /** Only when the shop lets this manager see customers. */
  customerName: string | null;
  reference: string | null;
  receiptNumber: string | null;
  createdAtMs: number;
}

export interface StaffRefundLimits {
  enabled: boolean;
  /** US cents. */
  capCents: number;
  dayCapCents: number;
  usedTodayCents: number;
  slsPerUsd: number;
  refundWindowDays: number;
}

/** The shop's recent counter payments, for the manager to refund from. */
export async function listShopPayments(): Promise<{ payments: StaffPayment[]; refunds: StaffRefundLimits }> {
  const result = await functions().httpsCallable('staffListPayments')({ ...actingFor() });
  return (result.data as { data: { payments: StaffPayment[]; refunds: StaffRefundLimits } }).data;
}

/**
 * A manager's refund for the shop, with their own PIN. `idempotencyKey` is
 * one per attempt, resent on retry, so a retry after a dropped response gets
 * the first answer; it goes on whole refunds too.
 */
export async function refundForShop(
  transactionId: string,
  pin: string,
  amountCents: number,
  partial: boolean,
  idempotencyKey: string
): Promise<{ refundTransactionId: string; remainingCents: number }> {
  const result = await functions().httpsCallable('refundPayment')({
    transactionId,
    pin,
    ...actingFor(),
    idempotencyKey,
    ...(partial ? { amountCents } : {}),
  });
  return (result.data as { data: { refundTransactionId: string; remainingCents: number } }).data;
}

/** A refund's size in US cents against the caps, as the server counts it. */
export function capCents(amount: number, currency: string, slsPerUsd: number): number {
  return currency === 'SLS' && slsPerUsd > 0 ? Math.ceil((amount * 100) / slsPerUsd) : amount;
}

/** The server's reason for a refusal, when it gave one. */
export function staffErrorReason(err: unknown): string | undefined {
  const e = err as { details?: { reason?: unknown }; code?: string };
  return typeof e?.details?.reason === 'string' ? e.details.reason : undefined;
}
