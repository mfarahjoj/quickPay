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

export async function updateStaff(staffUid: string, role: StaffRole, showCustomers: boolean, pin: string): Promise<void> {
  await functions().httpsCallable('staffUpdate')({ staffUid, role, showCustomers, pin });
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

/** The server's reason for a refusal, when it gave one. */
export function staffErrorReason(err: unknown): string | undefined {
  const e = err as { details?: { reason?: unknown }; code?: string };
  return typeof e?.details?.reason === 'string' ? e.details.reason : undefined;
}
