/**
 * Account deletion: what blocks it, and what it removes.
 *
 * Kept free of the callable wrapper and of module-level Firebase handles so
 * it can be tested with plain fakes; `deleteAccount.ts` wires in the real ones.
 *
 * What is deleted: everything that identifies the person — profile, KYC
 * records and uploads, profile picture, push tokens, trusted devices,
 * notifications, customer payment tokens, QR codes, role applications — and
 * the Firebase Auth login itself.
 *
 * What is kept, on purpose: the money trail. `transactions`, the ledger
 * (`journal_entries`, `ledger_balances`) and the wallet document stay, because
 * LEDGER_ARCHITECTURE.md makes them immutable and we owe regulators and
 * counterparties a record. None of them carries a name or phone number —
 * transactions identify people only by uid — so once the user document is
 * reduced to a tombstone they no longer identify anyone.
 */

import { AccountStatusFields, resolveAccountStatus } from "../utils/accountStatus";

/** Why an account cannot be deleted right now. */
export type DeletionBlocker =
  | "frozen"
  | "balance"
  | "pending_cash_out"
  | "pending_topup"
  | "pending_remittance"
  | "pending_payment";

/** A pending-work lookup: the collection, the user field, and what it means. */
const PENDING_CHECKS: ReadonlyArray<{
  collection: string;
  field: string;
  blocker: DeletionBlocker;
}> = [
  { collection: "cashOutRequests", field: "customerId", blocker: "pending_cash_out" },
  { collection: "agentTopupRequests", field: "customerId", blocker: "pending_topup" },
  { collection: "topups", field: "userId", blocker: "pending_topup" },
  { collection: "remittances", field: "senderId", blocker: "pending_remittance" },
  { collection: "paymentRequests", field: "customerId", blocker: "pending_payment" },
  { collection: "paymentRequests", field: "merchantId", blocker: "pending_payment" },
];

/** Collections that hold only this person's own data, and the field naming them. */
const OWNED_COLLECTIONS: ReadonlyArray<{ collection: string; field: string }> = [
  { collection: "customerTokens", field: "customerId" },
  { collection: "trustedDevices", field: "uid" },
  { collection: "notifications", field: "userId" },
  { collection: "qrCodes", field: "merchantId" },
  { collection: "roleRequests", field: "userId" },
];

/** Storage prefixes the apps upload to (see storage.rules). */
export const STORAGE_PREFIXES = (uid: string): string[] => [
  `kyc/${uid}/`,
  `profiles/${uid}/`,
];

const BATCH_SIZE = 400;

// The few Firestore/Storage/Auth members used, so tests can supply fakes.
export interface DeletionDeps {
  db: FirebaseFirestore.Firestore;
  deleteFiles: (prefix: string) => Promise<void>;
  deleteAuthUser: (uid: string) => Promise<void>;
  now: () => FirebaseFirestore.Timestamp;
}

/**
 * Everything that stops this account being deleted. Empty means it can go.
 *
 * Money in flight counts: a cash-out moves the customer's balance into a hold
 * account straight away, so a zero wallet does not mean nothing is owed.
 */
export async function findDeletionBlockers(
  db: FirebaseFirestore.Firestore,
  uid: string,
  user: AccountStatusFields | undefined,
  walletBalance: number
): Promise<DeletionBlocker[]> {
  const blockers = new Set<DeletionBlocker>();

  // Frozen accounts are held by support, possibly for compliance; deleting
  // would let someone walk away from a hold. Closed is fine — it is the state
  // a half-finished earlier deletion leaves behind.
  if (resolveAccountStatus(user) === "frozen") blockers.add("frozen");
  if (walletBalance !== 0) blockers.add("balance");

  const results = await Promise.all(
    PENDING_CHECKS.map(async (c) => {
      const snap = await db
        .collection(c.collection)
        .where(c.field, "==", uid)
        .where("status", "==", "pending")
        .limit(1)
        .get();
      return snap.empty ? null : c.blocker;
    })
  );
  for (const b of results) if (b) blockers.add(b);

  return [...blockers];
}

async function deleteQuery(
  db: FirebaseFirestore.Firestore,
  collection: string,
  field: string,
  uid: string
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await db
      .collection(collection)
      .where(field, "==", uid)
      .limit(BATCH_SIZE)
      .get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < BATCH_SIZE) return deleted;
  }
}

/**
 * Close the account and remove the personal data. Safe to run again after a
 * partial failure: every step tolerates its work already being done, and the
 * Auth login goes last so the person can retry until it succeeds.
 */
export async function eraseAccount(
  deps: DeletionDeps,
  uid: string
): Promise<void> {
  const { db } = deps;
  const userRef = db.collection("users").doc(uid);
  const walletRef = db.collection("wallets").doc(uid);

  // 1. Close it first, in one transaction with the balance check, so nothing
  // can be paid into or out of the account while it is being emptied.
  await db.runTransaction(async (tx) => {
    const [userSnap, walletSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(walletRef),
    ]);
    const balance = (walletSnap.data()?.balance as number | undefined) ?? 0;
    if (balance !== 0) {
      throw new Error("balance-changed");
    }
    if (userSnap.exists) {
      tx.update(userRef, {
        accountStatus: "closed",
        isActive: false,
        updatedAt: deps.now(),
      });
    }
    if (walletSnap.exists) tx.update(walletRef, { frozen: true });
  });

  // 2. Uploaded files: ID photos and profile picture.
  for (const prefix of STORAGE_PREFIXES(uid)) {
    await deps.deleteFiles(prefix);
  }

  // 3. The user's own subcollections (kyc, fcmTokens, anything added later).
  const subcollections = await userRef.listCollections();
  for (const sub of subcollections) {
    await db.recursiveDelete(sub);
  }

  // 4. Records that exist only for this person.
  for (const c of OWNED_COLLECTIONS) {
    await deleteQuery(db, c.collection, c.field, uid);
  }

  // 5. A merchant profile is referenced from other people's receipts, so keep
  // a stub that reads as a closed business rather than breaking those lookups.
  const merchantRef = db.collection("merchantProfiles").doc(uid);
  if ((await merchantRef.get()).exists) {
    await merchantRef.set({
      businessName: "Closed business",
      businessType: "",
      businessAddress: "",
      minimumSettlementAmount: 0,
      deletedAt: deps.now(),
    });
  }

  // 6. The user document becomes a tombstone: no name, phone, PIN, address,
  // KYC state or referral code. It stays so the ledger and other accounts'
  // lookups still resolve this uid, as a closed account.
  const existing = await userRef.get();
  await userRef.set({
    accountType: existing.data()?.accountType ?? "customer",
    accountStatus: "closed",
    isActive: false,
    fullName: "Deleted user",
    phoneNumber: "",
    deletedAt: deps.now(),
    createdAt: existing.data()?.createdAt ?? deps.now(),
  });

  // 7. Last: the login. If anything above failed we never get here, and the
  // person can sign in again and retry.
  await deps.deleteAuthUser(uid);
}
