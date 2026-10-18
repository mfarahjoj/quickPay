import { functions } from './firebase.config';
import { adoptSessionToken } from './auth.service';
import { getDeviceCredential } from './device.service';

/** A trusted phone on the account (review C9). Never carries a secret. */
export interface TrustedDevice {
  deviceId: string;
  name: string | null;
  platform: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export async function listMyDevices(): Promise<TrustedDevice[]> {
  const result = await functions().httpsCallable('listMyDevices')({});
  return (result.data as { data?: { devices?: TrustedDevice[] } }).data?.devices ?? [];
}

/** This phone's own device id, if it's trusted. */
export async function thisDeviceId(): Promise<string | null> {
  return (await getDeviceCredential())?.deviceId ?? null;
}

/** Forget one phone; every other session ends and this one signs back in. */
export async function removeMyDevice(deviceId: string): Promise<void> {
  const result = await functions().httpsCallable('removeMyDevice')({ deviceId });
  await adoptSessionToken(result.data);
}

export async function renameMyDevice(deviceId: string, name: string): Promise<void> {
  await functions().httpsCallable('renameMyDevice')({ deviceId, name });
}
