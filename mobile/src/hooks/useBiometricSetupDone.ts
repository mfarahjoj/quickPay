import { biometricSetupDoneFlag, useFlag } from '../services/signInFlags';

/** The Face ID offer was answered, either way. The gates move on at once. */
export async function markBiometricSetupDone(): Promise<void> {
  await biometricSetupDoneFlag.set(true);
}

export function useBiometricSetupDone(): boolean | null {
  return useFlag(biometricSetupDoneFlag);
}
