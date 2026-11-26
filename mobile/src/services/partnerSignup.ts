import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMyPendingAgreements, PendingAgreement, PendingAgreements } from './apiAgreement.service';

/**
 * Joining Zapp from a partner's app (Ridy).
 *
 * Before the person had Zapp, the partner left a request to link for their
 * number (getMyPendingAgreements). Sign-up fills in the name the partner has
 * for them; the Zaad screen then offers their 063 number and that name, as it
 * does for everyone. Once they're in — PIN, terms and Zaad done — the app
 * opens the request, so they approve it without going back to the partner.
 *
 * A request opened by deep link before sign-up would be lost: the app waits
 * only two minutes for sign-in. This finds it by the number instead.
 */

const OFFER_KEY = (uid: string) => `partnerLinkOffer:${uid}`;

let cache: { uid: string; result: Promise<PendingAgreements | null> } | null = null;

/** The requests waiting for [uid]'s number, asked once per sign-in. Null if they can't be read. */
export function loadPendingAgreements(uid: string): Promise<PendingAgreements | null> {
  if (cache?.uid !== uid) {
    const result = getMyPendingAgreements().catch(() => null);
    cache = { uid, result };
    // A failed read is asked again next time.
    result.then((r) => {
      if (r === null && cache?.result === result) cache = null;
    });
  }
  return cache.result;
}

/** The request to offer after sign-up: the newest left before they had Zapp, else the newest. */
export function requestToOffer(pending: PendingAgreements | null): PendingAgreement | null {
  if (!pending || pending.agreements.length === 0) return null;
  return pending.agreements.find((a) => a.signup) ?? pending.agreements[0];
}

/** At the end of sign-up: open [agreementId] once the app is ready. */
export async function rememberOffer(uid: string, agreementId: string): Promise<void> {
  await AsyncStorage.setItem(OFFER_KEY(uid), agreementId);
}

/** The request to open now, if sign-up left one. Each is handed out once. */
export async function takeOffer(uid: string): Promise<string | null> {
  const id = await AsyncStorage.getItem(OFFER_KEY(uid));
  if (id) await AsyncStorage.removeItem(OFFER_KEY(uid));
  return id;
}
