import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "./validatePin";
import { endSessions } from "./sessions";
import { getRates } from "../config/rates";
import { ApiResponse } from "../types";

/**
 * Deleting an account (App Store 5.1.1(v), Play's account-deletion policy).
 *
 *   request  → PIN, empty wallet; every session ends and every trusted phone is
 *              forgotten, so the account can't be used any more; it's due for
 *              deletion after `accountDeletionGraceDays` (config/rates).
 *   cancel   → signing back in (SMS) during the wait and entering the PIN
 *              keeps the account.
 *   daily    → due accounts are deleted: the sign-in record (which frees the
 *              phone number), PIN secrets, push tokens, trusted phones and
 *              the profile's personal details. users/{uid} stays as an
 *              anonymous tombstone so past transactions and the ledger, which
 *              the law requires kept, still resolve. An account that has
 *              money again (a refund, a dispute) is skipped and flagged.
 *
 * The same job removes sign-in records that never became an account — an
 * SMS code entered and the app closed before choosing a PIN — once they're a
 * week old.
 */

const DAY_MS = 24 * 3600 * 1000;
/** Sign-ins with no account behind them are kept this long. */
export const ORPHAN_AUTH_MAX_AGE_MS = 7 * DAY_MS;
const DEVICES = "trustedDevices";

/** What stays of users/{uid} once it's deleted: nothing that names a person. */
export function tombstone(user: Record<string, unknown>, nowMs: number): Record<string, unknown> {
  return {
    deleted: true,
    deletedAt: admin.firestore.Timestamp.fromMillis(nowMs),
    deletionRequestedAt: user.deletionRequestedAt ?? null,
    accountType: user.accountType ?? null,
    fullName: "Deleted account",
    isActive: false,
    accountStatus: "closed",
  };
}

/** Whether a user doc's deletion is due at [nowMs]. */
export function deletionDue(user: Record<string, unknown> | undefined, nowMs: number): boolean {
  const due = user?.deletionDueAt as { toMillis?: () => number } | undefined;
  return !!due?.toMillis && due.toMillis() <= nowMs && user?.deleted !== true;
}

/** Whether a sign-in record with no account is old enough to remove. */
export function isOrphanAuthUser(
  authUser: { metadata: { creationTime?: string; lastSignInTime?: string } },
  hasAccount: boolean,
  nowMs: number
): boolean {
  if (hasAccount) return false;
  const last = Date.parse(authUser.metadata.lastSignInTime ?? authUser.metadata.creationTime ?? "");
  return Number.isFinite(last) && nowMs - last > ORPHAN_AUTH_MAX_AGE_MS;
}

async function forgetTrustedDevices(uid: string): Promise<void> {
  const snap = await admin.firestore().collection(DEVICES).where("uid", "==", uid).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

export const requestAccountDeletion = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ pin: string; reason?: string }>
  ): Promise<ApiResponse<{ deletionDueAt: string }>> => {
    requireAuth(request);
    const userId = request.auth!.uid;
    const { pin, reason } = request.data ?? ({} as { pin: string; reason?: string });

    if (!pin || pin.length !== 6) {
      throw new https.HttpsError("invalid-argument", "PIN is required to delete account");
    }

    // Shared lockout-aware verification (throws resource-exhausted when locked)
    const isValid = await verifyUserPin(userId, pin);
    if (!isValid) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    const db = admin.firestore();
    const wallet = (await db.collection("wallets").doc(userId).get()).data() ?? {};
    if ((wallet.balance ?? 0) > 0 || (wallet.reservedCents ?? 0) > 0) {
      throw new https.HttpsError(
        "failed-precondition",
        "Please withdraw your remaining balance before deleting your account"
      );
    }

    const { accountDeletionGraceDays } = await getRates();
    const now = admin.firestore.Timestamp.now();
    const due = admin.firestore.Timestamp.fromMillis(now.toMillis() + accountDeletionGraceDays * DAY_MS);
    await db.collection("users").doc(userId).update({
      isActive: false,
      deletionRequestedAt: now,
      deletionDueAt: due,
      deletionReason: typeof reason === "string" ? reason.slice(0, 500) : null,
      updatedAt: now,
    });

    // Nothing more happens on this account: no phone can sign straight back in.
    await forgetTrustedDevices(userId);
    await endSessions(userId, { keepCaller: false });

    const dueText = due.toDate().toISOString().slice(0, 10);
    console.log(`Account deletion requested for ${userId}, due ${dueText}`);
    return {
      success: true,
      message: `Your account will be deleted on ${dueText}. Sign in again before then to keep it.`,
      data: { deletionDueAt: due.toDate().toISOString() },
    };
  }
);

/** Keep an account that's waiting to be deleted (signed in again by SMS, then PIN). */
export const cancelAccountDeletion = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ pin: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const pin = request.data?.pin;
    if (!pin || pin.length !== 6) {
      throw new https.HttpsError("invalid-argument", "Enter your PIN");
    }
    if (!(await verifyUserPin(uid, pin))) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }
    const db = admin.firestore();
    const ref = db.collection("users").doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const user = snap.data();
      if (!user || user.deleted === true) {
        throw new https.HttpsError("not-found", "This account has already been deleted");
      }
      if (!user.deletionRequestedAt) return;
      tx.update(ref, {
        isActive: true,
        deletionRequestedAt: admin.firestore.FieldValue.delete(),
        deletionDueAt: admin.firestore.FieldValue.delete(),
        deletionReason: admin.firestore.FieldValue.delete(),
        deletionBlocked: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.Timestamp.now(),
      });
    });
    return { success: true, message: "Your account is kept" };
  }
);

/** Delete one account whose wait is over. */
export async function deleteDueAccount(uid: string, nowMs: number): Promise<"deleted" | "has_money" | "not_due"> {
  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  const user = (await userRef.get()).data();
  if (!deletionDue(user, nowMs)) return "not_due";

  const walletRef = db.collection("wallets").doc(uid);
  const wallet = (await walletRef.get()).data();
  if ((wallet?.balance ?? 0) > 0 || (wallet?.reservedCents ?? 0) > 0) {
    await userRef.update({ deletionBlocked: "has_money", deletionBlockedAt: admin.firestore.Timestamp.now() });
    console.warn(`Account ${uid} is due for deletion but holds money; skipped`);
    return "has_money";
  }

  await forgetTrustedDevices(uid);
  // PIN secrets (private/auth), push tokens and anything else under the user.
  await db.recursiveDelete(userRef);
  await userRef.set(tombstone(user!, nowMs));
  await db.collection("merchantProfiles").doc(uid).delete().catch(() => undefined);
  if (wallet) {
    await walletRef.set({ status: "closed", closedAt: admin.firestore.Timestamp.now() }, { merge: true });
  }
  // Last: it frees the phone number for a new account.
  await admin.auth().deleteUser(uid).catch((e) => {
    if (e?.code !== "auth/user-not-found") throw e;
  });
  console.log(`Account ${uid} deleted`);
  return "deleted";
}

/** Remove sign-in records that never became an account. */
export async function removeOrphanAuthUsers(nowMs: number, maxPages = 20): Promise<number> {
  const db = admin.firestore();
  let removed = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await admin.auth().listUsers(1000, pageToken);
    for (const u of result.users) {
      // Staff sign in to the console with Google; only phone sign-ins are touched.
      if (u.customClaims?.admin === true || u.providerData.some((p) => p.providerId !== "phone")) continue;
      const hasAccount = (await db.collection("users").doc(u.uid).get()).exists;
      if (isOrphanAuthUser(u, hasAccount, nowMs)) {
        await admin.auth().deleteUser(u.uid).catch(() => undefined);
        removed++;
      }
    }
    pageToken = result.pageToken;
    if (!pageToken) break;
  }
  return removed;
}

export const processAccountDeletions = onSchedule(
  { schedule: "every day 02:00", timeZone: "Africa/Mogadishu" },
  async () => {
    const nowMs = Date.now();
    const due = await admin
      .firestore()
      .collection("users")
      .where("deletionDueAt", "<=", admin.firestore.Timestamp.fromMillis(nowMs))
      .limit(200)
      .get();
    const outcomes: Record<string, number> = {};
    for (const d of due.docs) {
      try {
        const r = await deleteDueAccount(d.id, nowMs);
        outcomes[r] = (outcomes[r] ?? 0) + 1;
      } catch (e) {
        console.error(`Deleting ${d.id} failed`, e);
        outcomes.failed = (outcomes.failed ?? 0) + 1;
      }
    }
    const orphans = await removeOrphanAuthUsers(nowMs);
    console.log("processAccountDeletions", { ...outcomes, orphanSignInsRemoved: orphans });
  }
);
