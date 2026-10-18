import authModule from '@react-native-firebase/auth';
import { auth, functions } from './firebase.config';
import { adoptSessionToken } from './auth.service';

/**
 * Moving the account to a new phone number (review E13). The account and its
 * money stay; only the number changes. See functions/src/auth/changePhone.ts
 * for the three proofs.
 */

/** Step 2: the PIN, plus the old number (fresh SMS sign-in) or the ID. */
export async function startPhoneChange(newPhone: string, pin: string, idLast4?: string): Promise<void> {
  await auth().currentUser?.getIdToken(true);
  await functions().httpsCallable('startPhoneChange')({ newPhone, pin, ...(idLast4 ? { idLast4 } : {}) });
}

/** Step 3a: text a code to the new number. Resolves to the verification id. */
export async function sendCodeToNewPhone(newPhone: string): Promise<string> {
  const snapshot = await auth().verifyPhoneNumber(newPhone);
  if (!snapshot?.verificationId) throw new Error('Could not send the code');
  return snapshot.verificationId;
}

export interface PhoneChangeResult {
  phoneNumber: string;
  sendingPausedUntil: string;
}

/** Step 3b: attach the verified new number, then move the account to it. */
export async function finishPhoneChange(verificationId: string, code: string): Promise<PhoneChangeResult> {
  const user = auth().currentUser;
  if (!user) throw new Error('Not signed in');
  const credential = authModule.PhoneAuthProvider.credential(verificationId, code);
  await user.updatePhoneNumber(credential);
  const result = await functions().httpsCallable('completePhoneChange')({});
  await adoptSessionToken(result.data);
  return (result.data as { data: PhoneChangeResult }).data;
}
