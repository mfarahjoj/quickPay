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
