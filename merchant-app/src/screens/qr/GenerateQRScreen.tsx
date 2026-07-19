import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import { generateQRCode } from '../../services/qr.service';
import { QRCodeData } from '../../types';
import {
  DarkScreen,
  ScreenHeader,
  GlassCard,
  PillButton,
  ACCENT,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';

export default function GenerateQRScreen() {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [qrData, setQrData] = useState<QRCodeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [focused, setFocused] = useState(false);
  const [refFocused, setRefFocused] = useState(false);

  const handleGenerate = async () => {
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      Alert.alert(t('common.invalidAmount'), t('common.invalidAmountMessage'));
      return;
    }
    try {
      setLoading(true);
      const result = await generateQRCode(amountNum, 'USD', reference.trim() || undefined);
      setQrData(result);
      startCountdown(result.expiresAt);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  };

  const startCountdown = (expiresAt: Date) => {
    const tick = () => {
      const diff = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      if (diff <= 0) {
        setTimeRemaining(0);
        setQrData(null);
        Alert.alert(t('qr.alerts.expiredTitle'), t('qr.alerts.expiredMessage'));
        return;
      }
      setTimeRemaining(diff);
      setTimeout(tick, 1000);
    };
    tick();
  };

  const handleNewQR = () => {
    setQrData(null);
    setAmount('');
    setTimeRemaining(0);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  // ── QR result view ──────────────────────────────
  if (qrData) {
    const warning = timeRemaining < 60;
    return (
      <DarkScreen scroll contentStyle={styles.resultContent}>
        <ScreenHeader title={t('qr.display.readyTitle')} subtitle={t('qr.display.scanSubtitle')} />

        <View style={styles.amountBadge}>
          <Text style={styles.amountBadgeLabel}>{t('qr.display.amount')}</Text>
          <Text style={styles.amountBadgeValue}>${parseFloat(amount).toFixed(2)}</Text>
          {reference.trim() ? (
            <Text style={styles.amountBadgeRef}>{reference.trim()}</Text>
          ) : null}
        </View>

        <View style={styles.qrFrame}>
          <QRCode value={qrData.qrData} size={240} backgroundColor="#FFFFFF" color="#000000" />
        </View>

        <View style={[styles.timer, warning && styles.timerWarn]}>
          <Text style={[styles.timerValue, warning && styles.timerValueWarn]}>
            {formatTime(timeRemaining)}
          </Text>
          <Text style={styles.timerLabel}>{t('qr.display.expiresIn')}</Text>
        </View>

        <View style={styles.resultFooter}>
          <PillButton label={t('qr.display.generateNew')} variant="glass" onPress={handleNewQR} />
          <Text style={styles.infoText}>{t('qr.display.keepOpen')}</Text>
        </View>
      </DarkScreen>
    );
  }

  // ── Amount entry view ───────────────────────────
  return (
    <DarkScreen scroll keyboard contentStyle={styles.content}>
      <ScreenHeader title={t('qr.receive.title')} subtitle={t('qr.receive.subtitle')} />

      <View style={styles.body}>
        <Text style={styles.label}>{t('qr.receive.referenceLabel', { defaultValue: 'ORDER / REFERENCE' })}</Text>
        <GlassCard style={[styles.refInputCard, refFocused && styles.amountInputCardFocused]}>
          <TextInput
            style={styles.refInput}
            placeholder={t('qr.receive.referencePlaceholder', { defaultValue: 'e.g. Table 4, Order #12' })}
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={reference}
            onChangeText={setReference}
            returnKeyType="next"
            onFocus={() => setRefFocused(true)}
            onBlur={() => setRefFocused(false)}
            autoFocus
          />
        </GlassCard>

        <Text style={[styles.label, { marginTop: 20 }]}>{t('qr.receive.amountLabel')}</Text>
        <GlassCard style={[styles.amountInputCard, focused && styles.amountInputCardFocused]}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </GlassCard>
        <Text style={styles.hint}>{t('qr.receive.amountHint')}</Text>
      </View>

      <View style={styles.footer}>
        <PillButton
          label={t('qr.receive.generateButton')}
          onPress={handleGenerate}
          loading={loading}
          disabled={!amount}
        />
        <Text style={styles.infoText}>{t('qr.receive.validityHint')}</Text>
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
  },
  resultContent: {
    paddingBottom: 40,
    alignItems: 'center',
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 24,
    flex: 1,
  },
  footer: {
    paddingHorizontal: 24,
    gap: 14,
  },

  label: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 12,
  },
  amountInputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 76,
  },
  amountInputCardFocused: {
    borderColor: ACCENT,
  },
  currency: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 40,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
    padding: 0,
  },
  hint: {
    fontSize: 13,
    color: TEXT_FAINT,
    marginTop: 12,
  },

  // result
  amountBadge: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 28,
  },
  amountBadgeLabel: {
    fontSize: 13,
    color: TEXT_FAINT,
    marginBottom: 4,
  },
  amountBadgeValue: {
    fontSize: 44,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -2,
  },
  amountBadgeRef: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 6,
    letterSpacing: 0.2,
  },
  refInputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 52,
  },
  refInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    padding: 0,
  },
  qrFrame: {
    backgroundColor: '#FFFFFF',
    padding: 22,
    borderRadius: 28,
    marginBottom: 28,
  },
  timer: {
    alignItems: 'center',
    backgroundColor: 'rgba(52,199,123,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52,199,123,0.35)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 32,
  },
  timerWarn: {
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderColor: 'rgba(255,59,48,0.35)',
  },
  timerValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#34C77B',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  timerValueWarn: {
    color: '#FF6961',
  },
  timerLabel: {
    fontSize: 12,
    color: TEXT_FAINT,
    marginTop: 2,
  },
  resultFooter: {
    alignSelf: 'stretch',
    paddingHorizontal: 24,
    gap: 14,
  },

  infoText: {
    fontSize: 13,
    color: TEXT_DIM,
    textAlign: 'center',
    lineHeight: 19,
  },
});
