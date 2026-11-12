/**
 * Automatic daily payouts (plan 3.6, decision D11).
 *
 * A merchant switches it on once, with their PIN, choosing a balance to keep
 * for refunds. The money goes to their Zaad account on file, like every
 * payout (auth/zaadAccount.ts). Every evening `runAutoPayouts` queues
 * a payout of everything above that balance, through the same path as a
 * manual request (createPayoutRequest: hold, 24-hour senior threshold, ops
 * desk). Ops still send the money, since there are no automated rails yet.
 *
 * Skipped for the night, with nothing held:
 * - a frozen or closed account, or one no longer a merchant;
 * - a merchant still in the pause after a PIN reset;
 * - a merchant with a payout already waiting;
 * - no Zaad account on file, or a number changed too recently;
 * - less than autoPayoutMinCents (config) above the kept balance.
 * Money reserved for a lost dispute (D8) is never counted as available.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { ApiResponse, User, Wallet } from "../types";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "../auth/validatePin";
import { isAccountActive } from "../utils/accountStatus";
import { isMerchantRole } from "../utils/roles";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { notifyUser } from "../utils/notifications";
import { getRates } from "../config/rates";
import { type FloatRoute } from "../ledger";
import { createPayoutRequest, PAYOUT_REQUESTS_COLLECTION } from "./requestPayout";
import { zaadLabel, zaadPayoutBlock } from "../auth/zaadAccount";

/** A typo should not become a five-figure transfer. */
const MAX_AUTO_PAYOUT_CENTS = 1_000_000_00;

export interface AutoPayoutSettings {
  enabled: boolean;
  /** Left in the wallet for refunds and change. */
  keepCents: number;
  updatedAt: FirebaseFirestore.Timestamp;
  // Set before payouts went only to the Zaad account on file; no longer read.
  route?: FloatRoute;
  destinationName?: string;
  destinationRef?: string;
}

interface SetAutoPayoutRequest {
  enabled: boolean;
  keepCents?: number;
  pin: string;
}

/** Switch automatic payouts on or off. Turning them on takes the PIN. */
export const setAutoPayout = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<SetAutoPayoutRequest>): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const d = request.data ?? ({} as SetAutoPayoutRequest);
    const db = admin.firestore();
    const user = (await db.collection("users").doc(uid).get()).data() as User | undefined;
    if (!user || !isMerchantRole(user.accountType)) {
      throw new https.HttpsError("permission-denied", "Only merchant accounts can set up payouts");
    }
    if (typeof d.pin !== "string" || !(await verifyUserPin(uid, d.pin))) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }
    const ref = db.collection("merchantProfiles").doc(uid);

    if (!d.enabled) {
      await ref.set({ autoPayout: { enabled: false, updatedAt: admin.firestore.Timestamp.now() } }, { merge: true });
      return { success: true, message: "Automatic payouts off" };
    }

    const keepCents = d.keepCents ?? 0;
    if (!Number.isInteger(keepCents) || keepCents < 0 || keepCents > MAX_AUTO_PAYOUT_CENTS) {
      throw new https.HttpsError("invalid-argument", "Choose a balance to keep of $0 or more");
    }
    if (!user.zaad?.msisdn || !user.zaad?.name) {
      throw new https.HttpsError("failed-precondition", "Add your Zaad account first");
    }
    const settings: AutoPayoutSettings = {
      enabled: true,
      keepCents,
      updatedAt: admin.firestore.Timestamp.now(),
    };
    await ref.set({ autoPayout: settings }, { merge: true });
    return { success: true, message: "Automatic payouts on" };
  }
);

/** One night's run. Returns how many payouts were queued. */
export async function runAutoPayoutsNow(): Promise<{ queued: number; skipped: number }> {
  const db = admin.firestore();
  const { autoPayoutMinCents, zaadChangeHoldHours } = await getRates();
  const profiles = await db.collection("merchantProfiles").where("autoPayout.enabled", "==", true).limit(500).get();

  let queued = 0;
  let skipped = 0;
  for (const doc of profiles.docs) {
    const uid = doc.id;
    const settings = doc.data().autoPayout as AutoPayoutSettings;
    try {
      const user = (await db.collection("users").doc(uid).get()).data() as User | undefined;
      if (!user || !isMerchantRole(user.accountType) || !isAccountActive(user)) {
        skipped++;
        continue;
      }
      if (zaadPayoutBlock(user, zaadChangeHoldHours, Date.now())) {
        skipped++;
        continue;
      }
      const zaad = user.zaad!;
      try {
        await assertResetCooldownAllows(uid, "other", 0);
      } catch {
        skipped++;
        continue;
      }
      const waiting = await db
        .collection(PAYOUT_REQUESTS_COLLECTION)
        .where("merchantId", "==", uid)
        .where("status", "==", "requested")
        .limit(1)
        .get();
      if (!waiting.empty) {
        skipped++;
        continue;
      }
      const wallet = (await db.collection("wallets").doc(uid).get()).data() as Wallet | undefined;
      const available = (wallet?.balance ?? 0) - (wallet?.reservedCents ?? 0) - settings.keepCents;
      if (available < autoPayoutMinCents) {
        skipped++;
        continue;
      }
      const amountCents = Math.min(available, MAX_AUTO_PAYOUT_CENTS);
      await createPayoutRequest(db, uid, user, {
        amountCents,
        route: "zaad",
        destinationName: zaad.name,
        destinationRef: zaad.msisdn,
        auto: true,
      });
      queued++;
      notifyUser(
        uid,
        "payout_sent",
        {
          key: "payout.auto_requested",
          params: { amount: `$${(amountCents / 100).toFixed(2)}`, destination: zaadLabel(zaad.msisdn) },
        },
        { type: "auto_payout" }
      ).catch(() => undefined);
    } catch (err) {
      // One merchant's failure must not stop the others; tomorrow retries.
      console.error(`Automatic payout for ${uid} failed:`, err);
      skipped++;
    }
  }
  return { queued, skipped };
}

/** Every evening at 18:00 Hargeisa time, after the day's trading. */
export const runAutoPayouts = onSchedule({ schedule: "0 18 * * *", timeZone: "Africa/Mogadishu" }, async () => {
  const { queued, skipped } = await runAutoPayoutsNow();
  console.log(`runAutoPayouts: queued ${queued}, skipped ${skipped}`);
});
