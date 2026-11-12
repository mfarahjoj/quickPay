import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { Platform } from 'react-native';
import { functions } from './firebase.config';
import { logger } from '../utils/logger';

const BIOMETRIC_ENABLED_KEY = '@quickpay_biometric_enabled';
const KEYCHAIN_SERVICE = 'com.quickpay.pin';

let _rnBiometrics: ReactNativeBiometrics | null = null;
function getRnBiometrics(): ReactNativeBiometrics {
  if (!_rnBiometrics) {
    _rnBiometrics = new ReactNativeBiometrics();
  }
  return _rnBiometrics;
}

export interface BiometricAvailability {
  available: boolean;
  biometryType?: string;
}

// In-memory handoff of the PIN the user just created (SetupPinScreen) or
// just signed in with (PinLoginScreen), so BiometricSetupScreen can store it
// in the keychain without asking for it again seconds later. Never
// persisted; consumed once, and dropped after a few minutes.
const PENDING_PIN_MS = 5 * 60 * 1000;
let _pendingSetupPin: { pin: string; at: number } | null = null;

export function setPendingSetupPin(pin: string): void {
  _pendingSetupPin = { pin, at: Date.now() };
}

export function consumePendingSetupPin(): string | null {
  const held = _pendingSetupPin;
  _pendingSetupPin = null;
  return held && Date.now() - held.at < PENDING_PIN_MS ? held.pin : null;
}

export async function isBiometricAvailable(): Promise<BiometricAvailability> {
  try {
    const { available, biometryType } = await getRnBiometrics().isSensorAvailable();
    return { available, biometryType };
  } catch {
    return { available: false };
  }
}

export async function authenticateWithBiometrics(
  promptMessage: string = 'Authenticate to continue'
): Promise<boolean> {
  try {
    const { success } = await getRnBiometrics().simplePrompt({
      promptMessage,
      cancelButtonText: 'Cancel',
    });
    return success;
  } catch {
    return false;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    return value === 'true';
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function getBiometricLabel(biometryType?: string): string {
  if (biometryType === BiometryTypes.FaceID) {
    return 'Face ID';
  }
  if (biometryType === BiometryTypes.TouchID) {
    return 'Touch ID';
  }
  return 'Biometrics';
}

/*
 * Biometrics backed by a hardware key (review A4, D11).
 *
 * Turning Face ID on makes a key pair on this phone that only Face ID or a
 * fingerprint can use, and registers the public half with the server. To
 * approve a payment or unlock, the phone signs a fresh server challenge and
 * gets back a one-time token, which it sends where the PIN would go. The PIN
 * itself is no longer kept on the phone.
 *
 * Installs from before this kept the PIN in the Keychain. The first Face ID
 * use after updating reads it one last time, registers a key with it and
 * deletes it.
 */
const BIOMETRIC_KEY_ID = '@quickpay_biometric_key_id';

async function storedKeyId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(BIOMETRIC_KEY_ID);
  } catch {
    return null;
  }
}

async function dropLegacyKeychainPin(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE }).catch(() => {});
}

/**
 * Turn on Face ID approval for this phone with the PIN just entered. Does
 * nothing if this phone already has a key. Throws if the server refuses.
 */
export async function enableBiometricKey(pin: string): Promise<void> {
  const rn = getRnBiometrics();
  // Keep a key that still works; one whose hardware half is gone (Face ID
  // re-enrolled) is replaced, or Face ID would look on and never work.
  if ((await storedKeyId()) && (await rn.biometricKeysExist().catch(() => ({ keysExist: false }))).keysExist) {
    await dropLegacyKeychainPin();
    return;
  }
  // A fresh pair each time: an old one may belong to a key the server forgot.
  await rn.deleteKeys().catch(() => undefined);
  const { publicKey } = await rn.createKeys();
  const result = await functions().httpsCallable('registerBiometricKey')({
    publicKey,
    pin,
    platform: Platform.OS,
  });
  const keyId = (result.data as { data?: { keyId?: string } }).data?.keyId;
  if (!keyId) throw new Error('Failed to secure biometrics');
  await AsyncStorage.setItem(BIOMETRIC_KEY_ID, keyId);
  await dropLegacyKeychainPin();
}

export type BiometricUnlock = 'ok' | 'cancelled' | 'unavailable';

/**
 * Face ID to open the app, checked on the phone: the hardware key signs
 * only after Face ID passes, so no server round trip is needed just to show
 * the wallet. Moving money still goes through getBiometricCredential, which
 * the server checks. 'unavailable' means the key is gone (Face ID was
 * re-enrolled, or the phone was restored): Face ID is turned off here and
 * the person uses the PIN.
 */
export async function unlockWithBiometrics(promptMessage: string): Promise<BiometricUnlock> {
  const keyId = await storedKeyId();
  if (!keyId) {
    // Pre-key installs: the Keychain PIN is what Face ID unlocks.
    return (await legacyKeychainPin(promptMessage)) ? 'ok' : 'cancelled';
  }
  const rn = getRnBiometrics();
  try {
    const { keysExist } = await rn.biometricKeysExist();
    if (!keysExist) {
      await turnOffHere();
      return 'unavailable';
    }
    const { success, signature } = await rn.createSignature({
      promptMessage,
      payload: `zapp-unlock:${Date.now()}`,
      cancelButtonText: 'Cancel',
    });
    return success && signature ? 'ok' : 'cancelled';
  } catch (error) {
    logger.warn('Biometric unlock failed:', error);
    return 'cancelled';
  }
}

async function turnOffHere(): Promise<void> {
  await AsyncStorage.multiRemove([BIOMETRIC_KEY_ID, BIOMETRIC_ENABLED_KEY]).catch(() => {});
  await getRnBiometrics().deleteKeys().catch(() => undefined);
}

type Challenge = { challengeId: string; payload: string };
const PREPARED_CHALLENGE_MS = 90 * 1000; // the server allows two minutes
let _prepared: { at: number; challenge: Promise<Challenge> } | null = null;

/**
 * Fetch the server's challenge while the person is still looking at the
 * payment screen, so pressing Face ID waits on one call instead of two.
 * Does nothing when Face ID is off.
 */
export function prepareBiometricApproval(): void {
  storedKeyId().then((keyId) => {
    if (!keyId) return;
    const challenge = fetchChallenge().then((r) => (r.data as { data: Challenge }).data);
    challenge.catch(() => undefined);
    _prepared = { at: Date.now(), challenge };
  });
}

async function takeChallenge(): Promise<Challenge> {
  const held = _prepared;
  _prepared = null;
  if (held && Date.now() - held.at < PREPARED_CHALLENGE_MS) {
    try {
      return await held.challenge;
    } catch {
      // fetch a fresh one below
    }
  }
  return ((await fetchChallenge()).data as { data: Challenge }).data;
}

/**
 * Face ID in place of the PIN: returns what to send as `pin` (a one-time
 * token), or null when the person cancelled or this phone has no key any
 * more, in which case they type the PIN.
 */
export async function getBiometricCredential(
  promptMessage: string = 'Authenticate to confirm payment'
): Promise<string | null> {
  const keyId = await storedKeyId();
  if (!keyId) return legacyKeychainPin(promptMessage);
  try {
    const { challengeId, payload } = await takeChallenge();
    const { success, signature } = await getRnBiometrics().createSignature({
      promptMessage,
      payload,
      cancelButtonText: 'Cancel',
    });
    if (!success || !signature) return null;
    const approved = await functions().httpsCallable('approveBiometric')({ challengeId, keyId, signature });
    return (approved.data as { data?: { pinToken?: string } }).data?.pinToken ?? null;
  } catch (error: any) {
    if (error?.details?.reason === 'biometric_key_gone') {
      // Removed on the server (another phone, support): stop offering it.
      await turnOffHere();
    } else {
      logger.warn('Biometric approval failed:', error);
    }
    return null;
  }
}

/**
 * The challenge is fetched before Face ID can show. Right after a cold start
 * the first call can fail while App Check and the connection warm up, so try
 * once more before giving up and asking for the PIN.
 */
async function fetchChallenge() {
  try {
    return await functions().httpsCallable('biometricChallenge')({});
  } catch (error) {
    logger.warn('Biometric challenge failed, retrying:', error);
    await new Promise<void>((resolve) => setTimeout(resolve, 700));
    return functions().httpsCallable('biometricChallenge')({});
  }
}

/** Pre-key installs: read the stored PIN once, then move to a key. */
async function legacyKeychainPin(promptMessage: string): Promise<string | null> {
  try {
    const authenticated = await authenticateWithBiometrics(promptMessage);
    if (!authenticated) return null;
    const credentials = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!credentials) return null;
    const pin = credentials.password;
    enableBiometricKey(pin).catch((err) => logger.warn('Moving biometrics to a key failed:', err));
    return pin;
  } catch {
    return null;
  }
}

/**
 * Turn Face ID off on this phone: forget the key here and on the server,
 * and any PIN an older build left in the Keychain. Never throws.
 */
export async function disableBiometricKey(): Promise<void> {
  const keyId = await storedKeyId();
  // The phone's half goes whatever the network does (signOut stops waiting
  // after a moment), so the server call runs alongside, not first.
  const removedOnServer = keyId
    ? functions()
        .httpsCallable('removeBiometricKey')({ keyId })
        .catch(() => undefined)
    : undefined;
  await AsyncStorage.removeItem(BIOMETRIC_KEY_ID).catch(() => {});
  await getRnBiometrics().deleteKeys().catch(() => undefined);
  await dropLegacyKeychainPin();
  await removedOnServer;
}
