import { useState, useEffect } from 'react';
import firestore from '@react-native-firebase/firestore';
import { pinSetupDoneFlag, useFlag } from '../services/signInFlags';

/** A PIN was just set on the account. The gates move on at once. */
export async function markPinSetupDone(): Promise<void> {
  await pinSetupDoneFlag.set(true);
}

/**
 * Whether the signed-in account has a PIN, or null while that isn't known.
 *
 * The SERVER is authoritative: a PIN is only "set up" if the user doc
 * actually has a PIN (`hasPin`; older accounts still carry `pinHash`).
 * Trusting the local flag alone traps users whose Firestore doc is
 * missing/incomplete (e.g. account never finished setup, or data was wiped)
 * on the "enter PIN" screen, where every PIN reads as wrong because
 * validateUserPin throws "User not found".
 *
 * A phone that already knows the account has one (kept from the last
 * launch) goes straight on and checks with the server behind it; waiting
 * for the server first held every launch on a spinner, for seconds on a weak
 * connection. Only a fresh sign-in waits for the answer. The last known
 * value stands when the read fails (offline).
 */
export function usePinSetupDone(uid: string | undefined): boolean | null {
  const stored = useFlag(pinSetupDoneFlag);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);

  useEffect(() => {
    // Signed out: signing back in, even to the same account, waits for a new answer.
    if (!uid) {
      setCheckedFor(null);
      return;
    }
    let cancelled = false;
    firestore()
      .collection('users')
      .doc(uid)
      .get()
      .then((doc) => {
        if (cancelled) return;
        const data = doc.data();
        pinSetupDoneFlag.set(doc.exists && (data?.hasPin === true || !!data?.pinHash));
        setCheckedFor(uid);
      })
      .catch(() => {
        if (!cancelled) setCheckedFor(uid);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (!uid) return null;
  // Known to have one: go on. The read above corrects it if the server disagrees.
  if (stored === true) return true;
  // Otherwise the server's answer decides (it sets the flag), or offline, no PIN.
  return checkedFor === uid ? false : null;
}
