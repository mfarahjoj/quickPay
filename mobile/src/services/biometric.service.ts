import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
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

// In-memory handoff of the PIN the user just created in SetupPinScreen so
// BiometricSetupScreen can store it in the keychain without asking the user
// to retype it seconds later. Never persisted; consumed once.
let _pendingSetupPin: string | null = null;

export function setPendingSetupPin(pin: string): void {
  _pendingSetupPin = pin;
}

export function consumePendingSetupPin(): string | null {
  const pin = _pendingSetupPin;
  _pendingSetupPin = null;
  return pin;
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

/**
 * Store the PIN in the Keychain (for payment confirmation / app unlock).
 *
 * The item is stored WITHOUT a biometric access-control flag. Writing a
 * `BIOMETRY_ANY` access-control item goes through `SecAccessControlCreateWithFlags`
 * and the Secure Enclave, which hard-crashes on some devices under the New
 * Architecture — it was the first (and only) Keychain write in onboarding, so
 * it crashed exactly when the user enabled Face ID and entered their PIN.
 * Instead we gate the *read* behind an explicit biometric prompt in
 * `getPinFromKeychain`, preserving the same guarantee (the PIN is only released
 * after a successful Face ID / Touch ID check) via the proven-working
 * `react-native-biometrics` path.
 */
export async function storePinInKeychain(pin: string): Promise<void> {
  try {
    // Drop any legacy item (older builds stored it with a biometric ACL) so we
    // always end up with a clean, plainly-readable entry.
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE }).catch(() => {});
    await Keychain.setGenericPassword('quickpay_user', pin, {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    logger.error('Failed to store PIN in Keychain:', error);
    throw new Error('Failed to secure PIN');
  }
}

/**
 * Retrieve the PIN from the Keychain, gated behind a biometric prompt.
 */
export async function getPinFromKeychain(
  promptMessage: string = 'Authenticate to confirm payment'
): Promise<string | null> {
  try {
    const authenticated = await authenticateWithBiometrics(promptMessage);
    if (!authenticated) return null;
    const credentials = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    return credentials ? credentials.password : null;
  } catch {
    return null;
  }
}

/**
 * Clear PIN from Keychain (when user disables biometrics)
 */
export async function clearPinFromKeychain(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  } catch {
    // Ignore
  }
}
