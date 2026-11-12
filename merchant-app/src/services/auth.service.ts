import { auth, functions } from './firebase.config';
import { unregisterPushNotifications } from './notification.service';
import { FirebaseAuthTypes } from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';

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
 * Sign out
 */
export async function signOut(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      '@quickpay_merchant_setup_done',
    ]).catch(() => {});
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

export interface MerchantSetupResult {
  /**
   * True when the requested role is waiting on admin review. Privileged roles
   * are granted by an admin, never chosen by the client, so this is the normal
   * outcome of onboarding rather than an error.
   */
  roleRequestPending: boolean;
  roleRequestId?: string;
}

/**
 * Submit merchant onboarding: sets the PIN and applies for the chosen role.
 *
 * Omit `pin` when the user already has one (e.g. an existing Zapp Pay customer
 * opening the merchant app). The role itself is NOT granted here — the caller
 * should expect `roleRequestPending` and let the onboarding gate take over.
 */
export async function completeMerchantSetup(data: {
  fullName: string;
  pin?: string;
  accountType: 'merchant' | 'topup_agent' | 'agent_merchant';
}): Promise<MerchantSetupResult> {
  try {
    const fn = functions().httpsCallable('setupPin');
    const payload: {
      fullName: string;
      accountType: 'merchant' | 'topup_agent' | 'agent_merchant';
      pin?: string;
    } = {
      fullName: data.fullName.trim(),
      accountType: data.accountType,
    };
    if (data.pin) {
      payload.pin = data.pin;
    }
    const result = await fn(payload);
    const responseData = result.data as {
      success: boolean;
      error?: string;
      data?: { roleRequestPending?: boolean; roleRequestId?: string };
    };
    if (!responseData.success) {
      throw new Error(responseData.error || 'Failed to complete registration');
    }
    return {
      roleRequestPending: responseData.data?.roleRequestPending === true,
      roleRequestId: responseData.data?.roleRequestId,
    };
  } catch (error: any) {
    logger.error('completeMerchantSetup error:', error);
    throw new Error(error.message || 'Failed to complete registration');
  }
}

/**
 * The PIN is locked: for a while (`secondsLeft`), or until it's reset
 * (`hardLocked`, review A3).
 */
export class PinLockoutError extends Error {
  secondsLeft?: number;
  hardLocked: boolean;

  constructor(message: string, secondsLeft?: number, hardLocked = false) {
    super(message);
    this.name = 'PinLockoutError';
    this.secondsLeft = secondsLeft;
    this.hardLocked = hardLocked;
  }
}

function lockoutFrom(error: any): PinLockoutError | null {
  if (error?.code !== 'functions/resource-exhausted') return null;
  return new PinLockoutError(error.message, error?.details?.secondsLeft, error?.details?.hardLocked === true);
}

/**
 * After a PIN reset or change, a device revoke or a freeze, the server ends
 * every session on the account (review A5) and hands this phone a token to
 * sign straight back in with. Without one this phone is signed out within
 * the hour like the rest. Never throws.
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

/** Check the PIN, for the app lock. Throws PinLockoutError while locked. */
export async function validatePin(pin: string): Promise<boolean> {
  try {
    const result = await functions().httpsCallable('validateUserPin')({ pin });
    return (result.data as { data?: { valid?: boolean } }).data?.valid === true;
  } catch (error: any) {
    throw lockoutFrom(error) ?? error;
  }
}

/** Change the PIN. Throws PinLockoutError, or the callable's error. */
export async function changePin(currentPin: string, newPin: string): Promise<void> {
  try {
    const result = await functions().httpsCallable('changePin')({ currentPin, newPin });
    await adoptSessionToken(result.data);
  } catch (error: any) {
    throw lockoutFrom(error) ?? error;
  }
}

export interface ResetPinResult {
  /** Sending money is paused until then. */
  cooldownUntil: string;
  allowanceCents: number;
}

/**
 * Reset a forgotten PIN after a fresh SMS code. Merchants have no trusted
 * phone yet, so the server asks for the last 4 of the ID ops checked when
 * approving the account (`details.reason` says which step comes next).
 */
export async function resetPin(newPin: string, idLast4?: string): Promise<ResetPinResult> {
  // Force-refresh so the callable sees the post-SMS auth_time.
  await auth().currentUser?.getIdToken(true);
  const result = await functions().httpsCallable('resetPin')({
    newPin,
    ...(idLast4 ? { idLast4 } : {}),
  });
  await adoptSessionToken(result.data);
  return (result.data as { data: ResetPinResult }).data;
}
