/**
 * The Zaad account every customer and merchant gives as their own: the
 * number and the name it is registered to. The apps ask for it once, before
 * anything else, and merchants' payouts go only here (payouts/requestPayout.ts,
 * payouts/autoPayout.ts).
 *
 * It is typed, not verified, so it never credits money to anyone: naming
 * someone else's number here gets you nothing. Changing it takes the PIN, and
 * payouts wait `zaadChangeHoldHours` after a new number, so a stolen session
 * can't send a merchant's takings somewhere new.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "./validatePin";
import { normaliseSomaliMsisdn } from "../utils/msisdn";
import { ApiResponse, User, ZaadAccount } from "../types";

interface SetZaadAccountRequest {
  msisdn: string;
  name: string;
  /** Needed only to change an account already on file. */
  pin?: string;
}

/**
 * "  amina   yusuf " → "amina yusuf"; null unless it reads like a person's
 * full name: two or more words of letters, 60 characters at most.
 */
export function normaliseZaadName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length > 60) return null;
  const words = name.split(" ");
  const ok = words.length >= 2 && words.every((w) => /^\p{L}[\p{L}\p{M}'’.-]*$/u.test(w));
  return ok ? name : null;
}

/** "+252634123456" → "Zaad 063 412 3456", for messages and the payout desk. */
export function zaadLabel(msisdn: string): string {
  const m = /^\+252(\d{2})(\d{3})(\d{4})$/.exec(msisdn);
  return `Zaad ${m ? `0${m[1]} ${m[2]} ${m[3]}` : msisdn}`;
}

/** Why payouts can't go to this account's Zaad right now, or null if they can. */
export function zaadPayoutBlock(
  user: Pick<User, "zaad"> | undefined,
  holdHours: number,
  nowMs: number
): "missing" | "changed_recently" | null {
  const zaad = user?.zaad;
  if (!zaad?.msisdn || !zaad?.name) return "missing";
  const changedAt = zaad.changedAt?.toMillis();
  if (changedAt !== undefined && nowMs - changedAt < holdHours * 3600 * 1000) {
    return "changed_recently";
  }
  return null;
}

/** The message for a [zaadPayoutBlock] reason. */
export function zaadPayoutBlockMessage(reason: "missing" | "changed_recently", holdHours: number): string {
  return reason === "missing"
    ? "Add your Zaad account first"
    : `Payouts go to a changed Zaad number ${holdHours} hours after the change`;
}

/**
 * In: `{ msisdn, name, pin? }`. The first time, no PIN: the apps ask for it
 * right after sign-up or unlock. Changing it afterwards takes the PIN.
 */
export const setZaadAccount = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<SetZaadAccountRequest>): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const msisdn = normaliseSomaliMsisdn(request.data?.msisdn);
    if (!msisdn) throw new https.HttpsError("invalid-argument", "Enter a number like 063 412 3456");
    const name = normaliseZaadName(request.data?.name);
    if (!name) {
      throw new https.HttpsError("invalid-argument", "Enter the full name your Zaad account is registered to");
    }

    const db = admin.firestore();
    const ref = db.collection("users").doc(uid);
    const user = (await ref.get()).data() as User | undefined;
    if (!user) throw new https.HttpsError("not-found", "Account not found");

    const current = user.zaad;
    if (current?.msisdn === msisdn && current?.name === name) {
      return { success: true, message: "Zaad account saved" };
    }
    if (current) {
      const pin = request.data?.pin;
      if (typeof pin !== "string" || !pin) {
        throw new https.HttpsError("invalid-argument", "PIN is required");
      }
      if (!(await verifyUserPin(uid, pin))) {
        throw new https.HttpsError("permission-denied", "Invalid PIN");
      }
    }

    // Only a new number starts the payout wait; fixing the name doesn't.
    const now = admin.firestore.Timestamp.now();
    const changedAt = current && current.msisdn !== msisdn ? now : current?.changedAt;
    const zaad: ZaadAccount = { msisdn, name, updatedAt: now, ...(changedAt ? { changedAt } : {}) };
    await ref.update({ zaad });
    return { success: true, message: "Zaad account saved" };
  }
);
