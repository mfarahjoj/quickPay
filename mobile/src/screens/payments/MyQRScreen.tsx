import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import { colors, spacing, borderRadius } from '../../theme';
import {
  resolveReceiveToken,
  TokenResponse,
  CUSTOMER_TOKEN_TTL_MS,
  BACKOFF_SECONDS_ON_FAILURE,
  secondsLeftFromToken,
} from '../../services/customerToken.service';
import { triggerHaptic } from '../../services/haptics.service';
import { formatCountdown } from '../../utils/time';

const REFRESH_AT_MS = BACKOFF_SECONDS_ON_FAILURE * 1000;

export default function MyQRScreen() {
  const { t } = useTranslation();
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchToken = useCallback(async (forceRefresh?: boolean) => {
    try {
      setLoading(true);
      setError(null);
      const data = await resolveReceiveToken({ forceRefresh: forceRefresh === true });
      if (!mountedRef.current) { return; }
      setToken(data);
      setSecondsLeft(secondsLeftFromToken(data));
      triggerHaptic('success');
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e.message || t('payments.myQr.loadFailed'));
      }
    } finally {
      if (mountedRef.current) { setLoading(false); }
    }
  }, [t]);

  useEffect(() => {
    if (!token) { return; }

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) { clearInterval(timerRef.current); }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); }
    };
  }, [token]);

  useEffect(() => {
    if (!token) { return; }

    const expiresMs = new Date(token.expiresAt).getTime() - Date.now();
    const refreshIn = Math.max(0, expiresMs - (CUSTOMER_TOKEN_TTL_MS - REFRESH_AT_MS));

    refreshTimerRef.current = setTimeout(() => {
      fetchToken(true);
    }, refreshIn);

    return () => {
      if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); }
    };
  }, [token, fetchToken]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.03,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  useEffect(() => {
    mountedRef.current = true;
    fetchToken();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchToken]);

  if (loading && !token) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('payments.myQr.generating')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => fetchToken(true)}>
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('payments.myQr.title')}</Text>
      <Text style={styles.subtitle}>
        {t('payments.myQr.subtitle')}
      </Text>

      <Animated.View
        style={[styles.qrCard, { transform: [{ scale: pulseAnim }] }]}
      >
        {token && (
          <QRCode
            value={token.tokenData}
            size={240}
            color="#000000"
            backgroundColor="#FFFFFF"
          />
        )}
      </Animated.View>

      <View
        style={[
          styles.timerPill,
          secondsLeft < 30 && styles.timerPillWarning,
        ]}
      >
        <Text
          style={[
            styles.timerText,
            secondsLeft < 30 && styles.timerTextWarning,
          ]}
        >
          {secondsLeft > 0
            ? t('payments.myQr.expiresIn', { time: formatCountdown(secondsLeft) })
            : t('payments.myQr.refreshing')}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.refreshButton}
        onPress={() => {
          triggerHaptic('medium');
          fetchToken(true);
        }}
      >
        <Text style={styles.refreshText}>{t('payments.myQr.generateNewCode')}</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        {t('payments.myQr.autoRefresh')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dark.canvas,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.dark.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.dark.textDim,
    marginBottom: spacing.xl,
  },
  qrCard: {
    padding: spacing.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.xxl,
    marginBottom: spacing.lg,
  },
  timerPill: {
    backgroundColor: colors.dark.accentSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    marginBottom: spacing.lg,
  },
  timerPillWarning: {
    backgroundColor: colors.dark.errorSoft,
  },
  timerText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.dark.accentText,
  },
  timerTextWarning: {
    color: colors.dark.error,
  },
  refreshButton: {
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.smPlus,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.dark.text,
  },
  hint: {
    fontSize: 12,
    color: colors.dark.textFaint,
    textAlign: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.dark.textDim,
  },
  errorText: {
    fontSize: 16,
    color: colors.dark.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.dark.accent,
    paddingVertical: spacing.smPlus,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
