import { trustThisDeviceWithPin } from '../services/auth.service';
import { pinVerifiedFlag, useFlag } from '../services/signInFlags';

// Set after the user proves knowledge of their account PIN on THIS install —
// creating it (SetupPin), verifying it (WelcomeBack, a PIN sign-in),
// resetting it, or unlocking the app. Returning users on a fresh install
// (where usePinSetupDone recovers "done" from the server) won't have it,
// which is what routes them through the welcome-back verification.

/**
 * Pass the PIN when it's in hand: trusting this phone for PIN sign-in needs
 * it (services/auth.service.ts, trustThisDeviceWithPin). The gates move on
 * as soon as this is called.
 */
export async function markPinVerifiedThisInstall(pin?: string): Promise<void> {
  if (pin) trustThisDeviceWithPin(pin);
  await pinVerifiedFlag.set(true);
}

export function usePinVerifiedThisInstall(): boolean | null {
  return useFlag(pinVerifiedFlag);
}
