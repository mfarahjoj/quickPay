import { Platform } from 'react-native';
import { auth, firestore, functions } from './firebase.config';
import { firstName, maskPhone } from './accountLabel';
import { clearReceiveTokenCache } from './customerToken.service';
import { unregisterPushNotifications } from './notification.service';
import {
  clearDeviceCredential,
  getDeviceCredential,
  hasDeviceCredential,
  storeDeviceCredential,
} from './device.service';
import { FirebaseAuthTypes } from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';

export interface SetupPinData {
  pin: string;
  fullName: string;
  accountType?: 'customer' | 'merchant';
  referralCode?: string;
}

/**
 * Send OTP to phone number
 */
export async function sendOTP(
  phoneNumber: string
): Promise<FirebaseAuthTypes.ConfirmationResult> {
  try {
    const confirmation = await auth().signInWithPhoneNumber(phoneNumber);
    return confirmation;
  } catch (error: any) {
    logger.error('Send OTP error:', error);
    throw new Error(error.message || 'Failed to send OTP');
  }
}

/**
 * Verify OTP and sign in
 */
export async function verifyOTP(
  confirmation: FirebaseAuthTypes.ConfirmationResult,
  code: string
): Promise<FirebaseAuthTypes.UserCredential> {
  try {
    const credential = await confirmation.confirm(code);
    if (!credential) {
      throw new Error('Invalid verification code');
    }
    return credential;
  } catch (error: any) {
    logger.error('Verify OTP error:', error);
    throw new Error(error.message || 'Invalid verification code');
  }
}

/**
 * Setup PIN and complete profile
 */
export async function setupPin(data: SetupPinData): Promise<{ alreadyHasPin: boolean }> {
  try {
    const setupPinFunction = functions().httpsCallable('setupPin');
    const result = await setupPinFunction(data);

    const responseData = result.data as {
      success: boolean;
      error?: string;
      data?: { alreadyHasPin?: boolean };
    };
    if (!responseData.success) {
      throw new Error(responseData.error || 'Failed to setup PIN');
    }
    // True when the account already had a PIN — the submitted PIN was NOT
    // stored, so callers must never treat it as the account PIN.
    return { alreadyHasPin: responseData.data?.alreadyHasPin === true };
  } catch (error: any) {
    logger.error('Setup PIN error:', error);
    throw new Error(error.message || 'Failed to setup PIN');
  }
}

/**
 * Thrown by PIN-verifying calls while the backend has the PIN locked out
 * after too many failed attempts.
 */
export class PinLockoutError extends Error {
  secondsLeft?: number;
  /** Locked until the PIN is reset, not for a while (review A3). */
  hardLocked: boolean;

  constructor(message: string, secondsLeft?: number, hardLocked = false) {
    super(message);
    this.name = 'PinLockoutError';
    this.secondsLeft = secondsLeft;
    this.hardLocked = hardLocked;
  }
}

/** The lockout explained in the customer's language. */
export function pinLockoutMessage(err: PinLockoutError, t: (key: string, opts?: any) => string): string {
  return err.hardLocked ? t('pin.hardLocked') : t('pin.lockedOut', { seconds: err.secondsLeft ?? 60 });
}

/**
 * Thrown by loginWithPin when this device has no usable trusted-device
 * credential. Callers should fall back to the phone + OTP flow.
 */
export class DeviceNotTrustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceNotTrustedError';
  }
}

/** Thrown by loginWithPin when the device is trusted but the PIN was wrong. */
export class IncorrectPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncorrectPinError';
  }
}

/**
 * Validate user PIN
 */
export async function validatePin(pin: string): Promise<boolean> {
  try {
    const validatePinFunction = functions().httpsCallable('validateUserPin');
    const result = await validatePinFunction({ pin });

    const data = result.data as { data?: { valid: boolean } };
    return data.data?.valid || false;
  } catch (error: any) {
    if (error?.code === 'functions/resource-exhausted') {
      throw new PinLockoutError(error.message, error?.details?.secondsLeft, error?.details?.hardLocked === true);
    }
    logger.error('Validate PIN error:', error);
    return false;
  }
}

/**
 * Reset a forgotten PIN. Requires a fresh OTP verification (the backend
 * checks the ID token's auth_time), so callers must re-run sendOTP/verifyOTP
 * immediately before this.
 */
export interface ResetPinResult {
  /** Sending money is paused until then. */
  cooldownUntil: string;
  /** What can still be spent at shops before then, in cents. */
  allowanceCents: number;
}

/**
 * After a PIN reset or change, a device revoke or a freeze, the server ends
 * every session on the account (review A5) and hands this phone a token to
 * sign straight back in with. Without one (the server couldn't mint it) this
 * phone is signed out within the hour like the rest. Never throws.
 */
export async function adoptSessionToken(data: unknown): Promise<void> {
  const token = (data as { data?: { sessionToken?: string } } | undefined)?.data?.sessionToken;
  if (!token) return;
  try {
    await auth().signInWithCustomToken(token);
  } catch (err) {
    logger.warn('Could not renew the session:', err);
  }
}

/**
 * On a phone that has been this account's trusted device for a week, the SMS
 * code is enough; anywhere else the server also asks for `idLast4`. Errors
 * keep their `details.reason` so the screen can take the next step.
 */
export async function resetPin(newPin: string, idLast4?: string): Promise<ResetPinResult> {
  try {
    // Force-refresh so the callable sees the post-reauth auth_time.
    await auth().currentUser?.getIdToken(true);
    const device = await getDeviceCredential();
    const resetPinFunction = functions().httpsCallable('resetPin');
    const result = await resetPinFunction({
      newPin,
      ...(device ? { deviceId: device.deviceId, deviceSecret: device.deviceSecret } : {}),
      ...(idLast4 ? { idLast4 } : {}),
    });

    const responseData = result.data as {
      success: boolean;
      error?: string;
      data: ResetPinResult;
    };
    if (!responseData.success) {
      throw new Error(responseData.error || 'Failed to reset PIN');
    }
    await adoptSessionToken(responseData);
    return responseData.data;
  } catch (error: any) {
    logger.error('Reset PIN error:', error);
    throw error;
  }
}

/**
 * The server only trusts a phone when it's sent the PIN (review C8). The
 * screens that check the PIN hand it here; it's kept in memory only, for a
 * few minutes, and dropped once used.
 */
const HELD_PIN_MS = 5 * 60 * 1000;
let heldPin: { pin: string; at: number } | null = null;

export function trustThisDeviceWithPin(pin: string): void {
  heldPin = { pin, at: Date.now() };
  if (auth().currentUser) registerTrustedDevice().catch(() => {});
}

function takeHeldPin(): string | null {
  const held = heldPin;
  heldPin = null;
  return held && Date.now() - held.at < HELD_PIN_MS ? held.pin : null;
}

/** "iPhone" / "Android phone", shown in the owner's device list. */
function deviceName(): string {
  return Platform.OS === 'ios' ? 'iPhone' : 'Android phone';
}

/** First name and masked number of the signed-in account, for the PIN sign-in screen. */
async function currentAccountLabel(): Promise<{ name?: string; phone?: string }> {
  const user = auth().currentUser;
  let name: string | undefined;
  try {
    const snap = await firestore().collection('users').doc(user?.uid ?? '-').get();
    name = firstName(snap.data()?.fullName);
  } catch {
    // The number alone still tells people whose account it is.
  }
  return { name, phone: maskPhone(user?.phoneNumber) };
}

/**
 * Phones trusted before the PIN sign-in screen named the account have a
 * credential without a label: add it, once, while signed in. No-op otherwise.
 */
export async function labelTrustedDevice(): Promise<void> {
  try {
    const cred = await getDeviceCredential();
    if (!cred || cred.label || !auth().currentUser) return;
    await storeDeviceCredential({ ...cred, label: await currentAccountLabel() });
  } catch (error) {
    logger.warn('Labelling the trusted device failed:', error);
  }
}

/**
 * Mint and store this device's trusted-device credential, so the next sign-in
 * here can use the PIN instead of an SMS code. Safe to call repeatedly — it
 * no-ops once a credential exists, or when no PIN has been entered lately.
 * Never throws: failing to trust a device is a downgrade to SMS login, not an
 * error worth blocking entry over.
 */
export async function registerTrustedDevice(): Promise<void> {
  try {
    if (await hasDeviceCredential()) return;
    const pin = takeHeldPin();
    if (!pin) return;

    const fn = functions().httpsCallable('registerTrustedDevice');
    const result = await fn({ platform: Platform.OS, pin, name: deviceName() });

    const responseData = result.data as {
      success: boolean;
      data?: { deviceId?: string; deviceSecret?: string };
    };
    const { deviceId, deviceSecret } = responseData.data ?? {};
    if (!responseData.success || !deviceId || !deviceSecret) {
      logger.warn('Trusted-device registration returned no credential');
      return;
    }

    await storeDeviceCredential({ deviceId, deviceSecret, label: await currentAccountLabel() });
  } catch (error) {
    logger.warn('Trusted-device registration failed:', error);
  }
}

/**
 * Sign in with the PIN alone, using this device's stored credential in place
 * of an SMS code. Only works on a device that previously verified by SMS.
 *
 * Throws PinLockoutError while the shared PIN lockout is active, and
 * DeviceNotTrustedError when the credential is missing or rejected — callers
 * should fall back to the phone + OTP flow on the latter.
 */
export async function loginWithPin(pin: string): Promise<void> {
  const cred = await getDeviceCredential();
  if (!cred) {
    throw new DeviceNotTrustedError('This device is not set up for PIN login.');
  }

  try {
    const fn = functions().httpsCallable('loginWithPin');
    const result = await fn({
      deviceId: cred.deviceId,
      deviceSecret: cred.deviceSecret,
      pin,
    });

    const responseData = result.data as {
      success: boolean;
      data?: { token?: string };
      error?: string;
    };
    const token = responseData.data?.token;
    if (!responseData.success || !token) {
      throw new Error(responseData.error || 'Failed to sign in');
    }

    await auth().signInWithCustomToken(token);
  } catch (error: any) {
    if (error instanceof DeviceNotTrustedError) throw error;

    if (error?.code === 'functions/resource-exhausted') {
      throw new PinLockoutError(error.message, error?.details?.secondsLeft, error?.details?.hardLocked === true);
    }
    // The server can't tell us apart from an unknown device on purpose, so a
    // rejection here means: stop trusting this credential, use SMS instead.
    if (error?.code === 'functions/permission-denied') {
      await clearDeviceCredential();
      throw new DeviceNotTrustedError(
        'This device is no longer recognised. Sign in with a code instead.'
      );
    }
    if (error?.code === 'functions/unauthenticated') {
      throw new IncorrectPinError('Incorrect PIN.');
    }
    logger.error('PIN login error:', error);
    throw new Error(error?.message || 'Failed to sign in');
  }
}

/**
 * Forget every trusted device on the account (lost or stolen phone). Every
 * device then has to verify by SMS again.
 */
export async function revokeTrustedDevices(): Promise<void> {
  try {
    const fn = functions().httpsCallable('revokeTrustedDevices');
    const result = await fn({});
    await adoptSessionToken(result.data);
  } finally {
    await clearDeviceCredential();
  }
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  try {
    const { disableBiometricKey } = await import('./biometric.service');
    await disableBiometricKey().catch(() => {});
    // Clear setup flags so user goes through full setup on next login.
    // biometric_enabled must go too — the keychain PIN it depends on was
    // just cleared, otherwise Security shows Face ID "on" with no PIN behind it.
    await AsyncStorage.multiRemove([
      '@quickpay_pin_setup_done',
      '@quickpay_biometric_setup_done',
      '@quickpay_biometric_enabled',
      '@quickpay_pin_verified_this_install',
    ]).catch(() => {});
    await clearReceiveTokenCache().catch(() => {});
    await unregisterPushNotifications().catch(() => {});
    await auth().signOut();
  } catch (error: any) {
    logger.error('Sign out error:', error);
    throw new Error(error.message || 'Failed to sign out');
  }
}

/**
 * Get current user
 */
export function getCurrentUser(): FirebaseAuthTypes.User | null {
  return auth().currentUser;
}

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChanged(
  callback: (user: FirebaseAuthTypes.User | null) => void
): () => void {
  return auth().onAuthStateChanged(callback);
}
