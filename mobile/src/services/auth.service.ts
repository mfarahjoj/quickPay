import { auth, functions } from './firebase.config';
import { clearReceiveTokenCache } from './customerToken.service';
import { unregisterPushNotifications } from './notification.service';
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

  constructor(message: string, secondsLeft?: number) {
    super(message);
    this.name = 'PinLockoutError';
    this.secondsLeft = secondsLeft;
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
      throw new PinLockoutError(error.message, error?.details?.secondsLeft);
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
export async function resetPin(newPin: string): Promise<void> {
  try {
    // Force-refresh so the callable sees the post-reauth auth_time.
    await auth().currentUser?.getIdToken(true);
    const resetPinFunction = functions().httpsCallable('resetPin');
    const result = await resetPinFunction({ newPin });

    const responseData = result.data as { success: boolean; error?: string };
    if (!responseData.success) {
      throw new Error(responseData.error || 'Failed to reset PIN');
    }
  } catch (error: any) {
    logger.error('Reset PIN error:', error);
    throw new Error(error.message || 'Failed to reset PIN');
  }
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  try {
    const { clearPinFromKeychain } = await import('./biometric.service');
    await clearPinFromKeychain().catch(() => {});
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
