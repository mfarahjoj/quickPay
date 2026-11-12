import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DarkScreen, PillButton, TEXT_DIM } from '../DarkScreen';
import { PinInput } from '../PinInput';
import { BrandLogo } from '../auth/BrandLogo';
import { PinLockoutError, signOut, validatePin } from '../../services/auth.service';
import { isAppLockEnabled, LOCK_AFTER_MS } from '../../utils/appLock';
import { ResetPinFlow } from './ResetPinFlow';
import { logger } from '../../utils/logger';

/** A PIN lockout, in the merchant's language. */
export function pinLockoutText(err: PinLockoutError, t: TFunction | ((k: string, o?: any) => string)): string {
  return err.hardLocked
    ? t('errors.pinHardLocked')
    : t('security.lock.lockedFor', { seconds: err.secondsLeft ?? 60 });
}

/**
 * App lock (review A3). Covers the app with a PIN screen when it opens, and
 * when it comes back after LOCK_AFTER_MS in the background. The app stays
 * mounted underneath, so the merchant returns to where they were.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [resetting, setResetting] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    isAppLockEnabled().then(setLocked);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (next === 'background') {
        backgroundedAt.current = Date.now();
      } else if (next === 'active' && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away >= LOCK_AFTER_MS && (await isAppLockEnabled())) {
          setPin('');
          setError('');
          setLocked(true);
        }
      }
    });
    return () => sub.remove();
  }, []);

  const unlock = useCallback(
    async (entered: string) => {
      if (checking) return;
      setChecking(true);
      try {
        if (await validatePin(entered)) {
          setLocked(false);
          setError('');
        } else {
          setError(t('errors.wrongPin'));
        }
      } catch (err: any) {
        if (err instanceof PinLockoutError) {
          setError(pinLockoutText(err, t));
        } else if (/not set up/i.test(err?.message ?? '')) {
          // No PIN yet (onboarding sends them to set one): nothing to unlock with.
          setLocked(false);
        } else {
          logger.error('App lock check failed:', err);
          setError(t('security.lock.checkFailed'));
        }
      } finally {
        setPin('');
        setChecking(false);
      }
    },
    [checking, t]
  );

  if (locked === null) return null;

  return (
    <View style={styles.fill}>
      {children}
      {locked && (
        <View style={StyleSheet.absoluteFill}>
          {resetting ? (
            <ResetPinFlow
              onDone={() => {
                setResetting(false);
                setLocked(false);
              }}
              onCancel={() => setResetting(false)}
            />
          ) : (
            <DarkScreen keyboard contentStyle={styles.centered}>
              <BrandLogo />
              <Text style={styles.title}>{t('security.lock.title')}</Text>
              <Text style={styles.sub}>{t('security.lock.subtitle')}</Text>
              <PinInput
                value={pin}
                onChange={(v) => {
                  setPin(v);
                  if (error) setError('');
                }}
                onComplete={unlock}
                style={styles.pin}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {checking ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
              <View style={styles.block}>
                <PillButton variant="glass" label={t('security.forgotPin')} onPress={() => setResetting(true)} />
                <PillButton
                  style={styles.signOut}
                  variant="glass"
                  label={t('settings.signOut')}
                  onPress={() => signOut().catch(() => undefined)}
                />
              </View>
            </DarkScreen>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 24,
  },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  pin: { marginTop: 28 },
  error: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  spinner: { marginTop: 20 },
  block: { alignSelf: 'stretch', marginTop: 36 },
  signOut: { marginTop: 12 },
});
