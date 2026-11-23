import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createFlag, type Flag } from './signInFlags.utils';

/**
 * The flags AppNavigator's sign-in gates read, shared by every screen that
 * sets them, so a change moves the gates at once. They used to be read from
 * storage once, when the app started, which went wrong both ways: signing
 * out and back in without restarting kept the last session's "PIN checked"
 * and skipped the PIN, and a PIN sign-in after a restart asked for the same
 * PIN a second time.
 *
 * A screen sets its flag when it's finished with the person: the gate moves
 * on the moment it changes.
 */

/** The account has a PIN: the server's answer, kept for the next launch. Also what locks the app at launch. */
export const pinSetupDoneFlag = createFlag(AsyncStorage, '@quickpay_pin_setup_done');

/** The PIN has been proven on this install since signing in. */
export const pinVerifiedFlag = createFlag(AsyncStorage, '@quickpay_pin_verified_this_install');

/** The Face ID offer has been answered since signing in. */
export const biometricSetupDoneFlag = createFlag(AsyncStorage, '@quickpay_biometric_setup_done');

/** A flag in a component, re-rendering when it changes. Null until loaded. */
export function useFlag(flag: Flag): boolean | null {
  return useSyncExternalStore(flag.subscribe, flag.get);
}

/**
 * All three belong to one sign-in. signOut clears storage before the session
 * ends; this clears memory too, once it has (AppNavigator, when signed out).
 */
export async function clearSignInFlags(): Promise<void> {
  await Promise.all([
    pinSetupDoneFlag.set(false),
    pinVerifiedFlag.set(false),
    biometricSetupDoneFlag.set(false),
  ]);
}
