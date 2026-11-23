/**
 * Referral bonuses (plan 1.2, decision D3).
 *
 * The bonus used to be paid at sign-up, which made every new SIM card free
 * money that could be cashed out at an agent (finding F2). Now sign-up only
 * records who invited whom (`recordReferral`), and the bonus is paid when the
 * new user does something real, as set in the admin console
 * (config/rates.referralUnlock):
 *
 *   first_cash_in — their first cash-in of at least referralMinCashInCents;
 *   kyc_verified  — when ops verify their ID;
 *   off           — never.
 *
 * `maybeUnlockReferral` is called after each of those events and pays at
 * most once per new user (entry id `referral_{newUserId}`). The inviter is
 * skipped, while the new user is still paid, when the inviter's account
 * isn't active or they've hit referralMonthlyCapPerReferrer this month.
 */

import * as admin from "firebase-admin";
import { getRates } from "../config/rates";
import { prepareJournalEntry, userAccount, PLATFORM_PROMO, JournalLine } from "../ledger";
import { isAccountActive } from "../utils/accountStatus";
import { notifyUser } from "../utils/notifications";
import { Transaction } from "../types";

/** "2026-10" in UTC: the month a bonus counts towards the cap. */
export function bonusMonth(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/**
 * At sign-up: remember the inviter behind a referral code. Pays nothing.
 * Unknown codes and self-referrals are ignored.
 */
export async function recordReferral(
  db: FirebaseFirestore.Firestore,
  newUserId: string,
  referralCode: string
): Promise<string | null> {
  const match = await db.collection("users").where("referralCode", "==", referralCode).limit(1).get();
  if (match.empty) return null;
  const referrerId = match.docs[0].id;
  if (referrerId === newUserId) return null;
  await db.collection("users").doc(newUserId).update({
    referredBy: referrerId,
    referralStatus: "pending",
  });
  return referrerId;
}

export type ReferralEvent = { kind: "cash_in"; amountCents: number } | { kind: "kyc_verified" };

/**
 * Pay the referral bonus if this event qualifies under the current rules.
 * Never throws into the caller: a bonus is marketing, the caller's flow is
 * money that already moved.
 */
export async function maybeUnlockReferral(newUserId: string, event: ReferralEvent): Promise<boolean> {
  try {
    const rates = await getRates();
    const qualifies =
      (rates.referralUnlock === "first_cash_in" &&
        event.kind === "cash_in" &&
        event.amountCents >= rates.referralMinCashInCents) ||
      (rates.referralUnlock === "kyc_verified" && event.kind === "kyc_verified");
    if (!qualifies || rates.referralBonusCents <= 0) return false;

    const db = admin.firestore();
    const newUserRef = db.collection("users").doc(newUserId);
    const bonus = rates.referralBonusCents;
    const month = bonusMonth();

    const paid = await db.runTransaction(async (tx) => {
      const newUser = (await tx.get(newUserRef)).data();
      const referrerId: string | undefined = newUser?.referredBy;
      if (!newUser || !referrerId || newUser.referralBonusClaimedAt || !isAccountActive(newUser)) return null;

      const referrerRef = db.collection("users").doc(referrerId);
      const referrer = (await tx.get(referrerRef)).data();
      const countThisMonth = referrer?.referralBonusMonth === month ? referrer.referralBonusMonthCount ?? 0 : 0;
      const payReferrer =
        !!referrer && isAccountActive(referrer) && countThisMonth < rates.referralMonthlyCapPerReferrer;

      const lines: JournalLine[] = [
        { account: PLATFORM_PROMO, debit: bonus * (payReferrer ? 2 : 1), credit: 0 },
        { account: userAccount(newUserId), debit: 0, credit: bonus },
      ];
      if (payReferrer) lines.push({ account: userAccount(referrerId), debit: 0, credit: bonus });

      const entryId = `referral_${newUserId}`;
      const pending = await prepareJournalEntry(tx, {
        entryId,
        type: "referral_bonus",
        currency: "USD",
        lines,
        description: "Referral bonus",
        postedBy: "system",
      });
      if (pending.alreadyPosted) return null;

      const now = admin.firestore.Timestamp.now();
      pending.write(tx);

      const row = (toUserId: string, description: string): Transaction => ({
        type: "referral",
        kind: "referral",
        fromUserId: "system",
        toUserId,
        participants: ["system", toUserId],
        amount: bonus,
        currency: "USD",
        status: "completed",
        description,
        journalEntryId: entryId,
        createdAt: now,
        completedAt: now,
      });
      tx.set(db.collection("transactions").doc(), row(newUserId, `Referral bonus — invited by ${referrer?.fullName ?? "a friend"}`));
      if (payReferrer) {
        tx.set(db.collection("transactions").doc(), row(referrerId, `Referral bonus — you invited ${newUser.fullName ?? "a friend"}`));
        tx.update(referrerRef, {
          referralCount: admin.firestore.FieldValue.increment(1),
          referralBonusMonth: month,
          referralBonusMonthCount: countThisMonth + 1,
        });
      }
      tx.update(newUserRef, { referralBonusClaimedAt: now, referralStatus: "paid" });
      return { referrerId, payReferrer };
    });

    if (!paid) return false;
    const amount = `$${(bonus / 100).toFixed(2)}`;
    notifyUser(newUserId, "topup_completed", { key: "referral.welcome_bonus", params: { amount } }, {
      type: "referral_bonus",
    }).catch(() => undefined);
    if (paid.payReferrer) {
      notifyUser(paid.referrerId, "topup_completed", { key: "referral.friend_joined", params: { amount } }, {
        type: "referral_bonus",
      }).catch(() => undefined);
    }
    return true;
  } catch (err) {
    console.error(`maybeUnlockReferral(${newUserId}) failed:`, err);
    return false;
  }
}
