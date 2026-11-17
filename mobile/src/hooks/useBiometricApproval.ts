import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BiometryTypes } from 'react-native-biometrics';
import {
  getBiometricCredential,
  isBiometricAvailable,
  isBiometricEnabled,
  prepareBiometricApproval,
} from '../services/biometric.service';

export function biometricLabelKey(biometryType?: string): string {
  if (biometryType === BiometryTypes.FaceID) return 'biometric.faceId';
  if (biometryType === BiometryTypes.TouchID) return 'biometric.touchId';
  return 'biometric.generic';
}

/**
 * Face ID in place of the PIN, for any screen that approves a debit. The
 * server takes the one-time token `approve` returns wherever it takes a PIN
 * (verifyUserPin), so a screen only swaps what it sends.
 *
 * `checked` turns true once the phone has answered, so a screen can wait for
 * it before deciding to open the PIN keyboard.
 */
export function useBiometricApproval() {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);
  const [available, setAvailable] = useState(false);
  const [biometryType, setBiometryType] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    Promise.all([isBiometricEnabled(), isBiometricAvailable()])
      .then(([enabled, { available: hasSensor, biometryType: type }]) => {
        if (cancelled) return;
        setAvailable(enabled && hasSensor);
        setBiometryType(type);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Fetch the server's challenge early, so the tap waits on one call, not two. */
  const prepare = useCallback(() => {
    if (available) prepareBiometricApproval();
  }, [available]);

  /** The token to send as `pin`, or null when cancelled (type the PIN instead). */
  const approve = useCallback((promptMessage: string) => getBiometricCredential(promptMessage), []);

  return {
    checked,
    available,
    label: t(biometricLabelKey(biometryType)),
    prepare,
    approve,
  };
}
