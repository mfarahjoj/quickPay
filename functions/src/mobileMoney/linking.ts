import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { resolveAccountStatus } from "../utils/accountStatus";
import { getRates } from "../config/rates";
import { Currency, formatAmount, fromLimitCents, parseCurrency } from "../utils/money";
import { LinkedNumber, Provider, isProvider, limitsFor, linkId, normaliseSomaliMsisdn } from "./core";
import { isAgentRole } from "../utils/roles";
import { LINKED_NUMBERS } from "./receipts";

export const COLLECTION_CONFIG = "config/collection";

/** A pending link someone never activated stops blocking the number after this. */
export const PENDING_LINK_TTL_MS = 24 * 3600 * 1000;

/** config/collection: `{ zaad: { number, active }, edahab: { number, active } }`. */
export async function collectionNumber(provider: Provider): Promise<string | null> {
  const snap = await admin.firestore().doc(COLLECTION_CONFIG).get();
  const entry = snap.exists ? snap.get(provider) : null;
  if (!entry || entry.active !== true) return null;
  return normaliseSomaliMsisdn(entry.number);
}

/**
 * Zaad's transfer, prefilled. Dollars: `*880*0634123456*0.10#`. Shillings:
 * `*220*634123456*30000#` (Telesom's shilling code takes the number without
 * the leading 0 and whole shillings). Null for eDahab until its codes are
 * confirmed.
 */
export function dialCode(provider: Provider, toMsisdn: string, amount: number, currency: Currency = "USD"): string | null {
  if (provider !== "zaad") return null;
  const national = toMsisdn.slice(4);
  if (currency === "SLS") return `*220*${national}*${amount}#`;
  return `*880*0${national}*${(amount / 100).toFixed(2)}#`;
}

/**
 * Customer: link a Zaad/eDahab number to top up from. The number starts
 * pending; sending the activation payment from it verifies it (receipts.ts).
 *
 * In: `{ provider, msisdn }`. Out: what to send, where, and the dial code.
 */
export const startNumberLink = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAuth(request);
  const uid = request.auth!.uid;
  const provider = request.data?.provider;
  if (!isProvider(provider)) throw new https.HttpsError("invalid-argument", "Choose Zaad or eDahab");
  const msisdn = normaliseSomaliMsisdn(request.data?.msisdn);
  if (!msisdn) throw new https.HttpsError("invalid-argument", "Enter a number like 063 412 3456");

  const userSnap = await admin.firestore().collection("users").doc(uid).get();
  const status = resolveAccountStatus(userSnap.data() as Parameters<typeof resolveAccountStatus>[0]);
  if (status !== "active") throw new https.HttpsError("failed-precondition", "Your account can't link numbers right now");

  const to = await collectionNumber(provider);
  if (!to) throw new https.HttpsError("unavailable", "Top-ups by this method aren't open yet");
  const rates = await getRates();
  const creditsFloat = isAgentRole(userSnap.get("accountType"));
  const limits = limitsFor(rates, creditsFloat);

  const db = admin.firestore();
  const ref = db.collection(LINKED_NUMBERS).doc(linkId(provider, msisdn));
  const mine = db.collection(LINKED_NUMBERS).where("uid", "==", uid).where("provider", "==", provider);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const [snap, mineSnap] = await Promise.all([tx.get(ref), tx.get(mine)]);
    if (snap.exists) {
      const link = snap.data() as LinkedNumber & { createdAt?: admin.firestore.Timestamp };
      if (link.uid !== uid) {
        const age = now - (link.createdAt?.toMillis() ?? 0);
        if (link.status === "verified" || age < PENDING_LINK_TTL_MS) {
          throw new https.HttpsError("already-exists", "This number is linked to another Zapp account");
        }
      } else if (link.status === "verified") {
        return; // already theirs and verified
      }
    }
    for (const other of mineSnap.docs) {
      if (other.id === ref.id) continue;
      const o = other.data() as LinkedNumber & { verifiedAt?: admin.firestore.Timestamp; createdAt?: admin.firestore.Timestamp };
      const since = (o.verifiedAt ?? o.createdAt)?.toMillis() ?? 0;
      if (o.status === "verified" && now - since < rates.linkChangeCooldownHours * 3600 * 1000) {
        throw new https.HttpsError(
          "failed-precondition",
          `You can link a different number ${rates.linkChangeCooldownHours} hours after linking the last one`
        );
      }
      tx.delete(other.ref);
    }
    tx.set(ref, {
      uid,
      provider,
      msisdn,
      status: "pending",
      createdAt: admin.firestore.Timestamp.fromMillis(now),
    });
    tx.set(
      db.collection("users").doc(uid),
      { linkedAccounts: { [`${provider}Phone`]: msisdn, [`${provider}Verified`]: false } },
      { merge: true }
    );
  });

  const verified = (await ref.get()).get("status") === "verified";
  return {
    success: true,
    data: {
      provider,
      msisdn,
      status: verified ? "verified" : "pending",
      collectionNumber: to,
      activationCents: rates.linkActivationCents,
      dialCode: verified ? null : dialCode(provider, to, rates.linkActivationCents),
      topupMinCents: limits.topupMinCents,
      topupMaxCents: limits.topupMaxCents,
      // Where money from this number goes: an agent's float, or the wallet.
      creditsFloat,
    },
  };
});

/** Customer: where to send a top-up, and the prefilled dial code for [amountCents]. */
export const getTopupInstructions = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAuth(request);
  const uid = request.auth!.uid;
  const provider = request.data?.provider;
  if (!isProvider(provider)) throw new https.HttpsError("invalid-argument", "Choose Zaad or eDahab");
  // `amountCents` is in the currency's smallest unit: whole shillings for SLS.
  const amountCents = request.data?.amountCents;
  const currency = parseCurrency(request.data?.currency);
  if (!currency) throw new https.HttpsError("invalid-argument", "Top up in dollars or shillings");
  const rates = await getRates();
  const caller = (await admin.firestore().collection("users").doc(uid).get()).data();
  const creditsFloat = isAgentRole(caller?.accountType);
  const limits = limitsFor(rates, creditsFloat);
  if (currency === "SLS" && !limits.shillings) {
    throw new https.HttpsError("failed-precondition", "Agents buy float in dollars for now", { reason: "currency" });
  }
  // The limits are in dollars; shown to the customer in the currency they chose.
  const min = fromLimitCents(limits.topupMinCents, currency, rates.slsPerUsd, "up");
  const max = fromLimitCents(limits.topupMaxCents, currency, rates.slsPerUsd, "down");
  if (!Number.isInteger(amountCents) || amountCents < min || amountCents > max) {
    throw new https.HttpsError(
      "invalid-argument",
      `Top up between ${formatAmount(min, currency)} and ${formatAmount(max, currency)}`,
      { reason: "amount_out_of_range", minCents: min, maxCents: max, currency }
    );
  }
  const to = await collectionNumber(provider);
  if (!to) throw new https.HttpsError("unavailable", "Top-ups by this method aren't open yet");
  const links = await admin.firestore().collection(LINKED_NUMBERS)
    .where("uid", "==", uid).where("provider", "==", provider).where("status", "==", "verified").get();
  if (links.empty) throw new https.HttpsError("failed-precondition", "Link and activate your number first");
  return {
    success: true,
    data: {
      provider,
      fromMsisdn: links.docs[0].get("msisdn"),
      collectionNumber: to,
      amountCents,
      currency,
      dialCode: dialCode(provider, to, amountCents, currency),
      creditsFloat,
    },
  };
});
