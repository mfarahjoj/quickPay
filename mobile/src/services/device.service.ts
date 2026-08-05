import * as Keychain from 'react-native-keychain';
import { logger } from '../utils/logger';

/**
 * Credential proving this device previously completed SMS verification for an
 * account, so PIN-only login is allowed here.
 *
 * Deliberately stored under its own Keychain service — `signOut` clears
 * `com.quickpay.pin`, and this must survive that, otherwise signing out would
 * un-trust the device and force an SMS code on the way back in. Uses plain
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY with no biometric ACL: a Secure-Enclave ACL
 * write is what hard-crashed onboarding in build 11.
 */

const KEYCHAIN_SERVICE = 'com.quickpay.device';
const ACCOUNT = 'quickpay_device';

export interface DeviceCredential {
  deviceId: string;
  deviceSecret: string;
}

export async function getDeviceCredential(): Promise<DeviceCredential | null> {
  try {
    const stored = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!stored) return null;

    const parsed = JSON.parse(stored.password) as Partial<DeviceCredential>;
    if (!parsed?.deviceId || !parsed?.deviceSecret) return null;

    return { deviceId: parsed.deviceId, deviceSecret: parsed.deviceSecret };
  } catch (error) {
    // A corrupt or unreadable entry just means "not trusted" — fall back to SMS.
    logger.warn('Failed to read device credential:', error);
    return null;
  }
}

export async function storeDeviceCredential(cred: DeviceCredential): Promise<void> {
  await Keychain.setGenericPassword(ACCOUNT, JSON.stringify(cred), {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearDeviceCredential(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  } catch (error) {
    logger.warn('Failed to clear device credential:', error);
  }
}

export async function hasDeviceCredential(): Promise<boolean> {
  return (await getDeviceCredential()) !== null;
}
