import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Share,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import NetInfo from '@react-native-community/netinfo';
import QRCode from 'react-native-qrcode-svg';
import { firestore } from '../../services/firebase.config';
import {
  generateQRCode,
  generateMerchantSticker,
  cancelQRCode,
} from '../../services/qr.service';
import { triggerHaptic } from '../../services/haptics.service';
import { QRCodeData, MerchantStickerData, QRSettlement } from '../../types';
import { toCents, formatCents, sanitizeAmountInput } from '../../utils/money';
import { callableErrorKey } from '../../utils/errors';
import {
  DarkScreen,
  ScreenHeader,
  GlassCard,
  PillButton,
  ACCENT,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';

type Mode = 'charge' | 'counter';
type Phase = 'entry' | 'showing' | 'paid' | 'expired';

const QR_SIZE = 260;

export default function GenerateQRScreen() {
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>('charge');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [qrData, setQrData] = useState<QRCodeData | null>(null);
  const [settlement, setSettlement] = useState<QRSettlement | null>(null);
  const [phase, setPhase] = useState<Phase>('entry');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [focused, setFocused] = useState(false);
  const [refFocused, setRefFocused] = useState(false);
  const [offline, setOffline] = useState(false);

  // Counter-code mode
  const [sticker, setSticker] = useState<MerchantStickerData | null>(null);
  const [stickerLoading, setStickerLoading] = useState(false);
  const stickerRef = useRef<any>(null);

  const amountCents = toCents(amount);

  // ── Connectivity ────────────────────────────────
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false);
    });
    return unsub;
  }, []);

  // ── Countdown ───────────────────────────────────
  // Driven off the expiry timestamp rather than a decrementing counter, so
  // backgrounding the app can't desync it from the server's clock.
  useEffect(() => {
    if (phase !== 'showing' || !qrData) return;

    const tick = () => {
      const diff = Math.floor((qrData.expiresAt.getTime() - Date.now()) / 1000);
      if (diff <= 0) {
        setTimeRemaining(0);
        // Keep the amount and reference — the merchant almost always wants the
        // same sale again, and re-typing it holds up the queue.
        setPhase('expired');
        return;
      }
      setTimeRemaining(diff);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, qrData]);

  // ── Live settlement watch ───────────────────────
  // The push notification is a fallback, not the mechanism: a merchant who
  // denied notifications, or whose phone is on the counter, still has to see
  // the sale land on this screen.
  useEffect(() => {
    if (phase !== 'showing' || !qrData) return;

    const unsub = firestore()
      .collection('qrCodes')
      .doc(qrData.qrCodeId)
      .onSnapshot(
        (doc) => {
          const data = doc.data();
          if (!data) return;
          if (data.status === 'used') {
            setSettlement({
              paidByName: data.paidByName,
              paidAmount: data.paidAmount ?? data.amount,
              feeCents: data.feeCents,
              netCents: data.netCents,
              transactionId: data.transactionId,
              reference: data.reference,
            });
            triggerHaptic('payment');
            setPhase('paid');
          } else if (data.status === 'expired') {
            setPhase('expired');
          }
        },
        (err) => {
          // A dropped listener must not look like a completed sale.
          setError(t('qr.errors.watchFailed'));
          console.warn('QR watch failed:', err);
        }
      );

    return unsub;
  }, [phase, qrData, t]);

  // ── Counter code ────────────────────────────────
  const loadSticker = useCallback(async () => {
    if (sticker || stickerLoading) return;
    try {
      setStickerLoading(true);
      setError(null);
      setSticker(await generateMerchantSticker());
    } catch (e: any) {
      setError(t(callableErrorKey(e)));
    } finally {
      setStickerLoading(false);
    }
  }, [sticker, stickerLoading, t]);

  useEffect(() => {
    if (mode === 'counter') loadSticker();
  }, [mode, loadSticker]);

  const handleShareSticker = async () => {
    if (!sticker) return;
    const message = t('qr.counter.shareMessage', { name: sticker.merchantName });
    try {
      const dataUrl: string | null = await new Promise((resolve) => {
        if (!stickerRef.current?.toDataURL) return resolve(null);
        stickerRef.current.toDataURL((data: string) => resolve(data));
      });
      if (dataUrl) {
        await Share.share({ url: `data:image/png;base64,${dataUrl}`, message });
        return;
      }
    } catch {
      // Fall through to a plain text share below.
    }
    try {
      await Share.share({ message });
    } catch {
      // User dismissed the sheet.
    }
  };

  // ── Charge flow ─────────────────────────────────
  const handleGenerate = async () => {
    if (amountCents <= 0) {
      setError(t('common.invalidAmountMessage'));
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const result = await generateQRCode(amountCents, 'USD', reference.trim() || undefined);
      setQrData(result);
      setPhase('showing');
    } catch (e: any) {
      setError(t(callableErrorKey(e)));
    } finally {
      setLoading(false);
    }
  };

  const handleNewSale = () => {
    // Void an abandoned code so it can't be paid later off a stale screen.
    if (phase === 'showing' && qrData) cancelQRCode(qrData.qrCodeId);
    setQrData(null);
    setSettlement(null);
    setAmount('');
    setReference('');
    setTimeRemaining(0);
    setError(null);
    setPhase('entry');
  };

  const handleEditAmount = () => {
    setQrData(null);
    setTimeRemaining(0);
    setError(null);
    setPhase('entry');
  };

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  // ── Paid ────────────────────────────────────────
  if (phase === 'paid' && settlement) {
    const gross = settlement.paidAmount ?? amountCents;
    const fee = settlement.feeCents;
    const net = settlement.netCents;
    // Only show the split when the server actually sent it. Defaulting a
    // missing fee to zero would tell the merchant they netted the full amount
    // when they did not — a wrong number here is worse than no number.
    const hasSplit = typeof fee === 'number' && typeof net === 'number';
    return (
      <DarkScreen scroll contentStyle={styles.resultContent}>
        <View style={styles.paidIcon}>
          <SuccessCheckIcon size={76} />
        </View>
        <Text style={styles.paidTitle}>{t('qr.paid.title')}</Text>
        <Text style={styles.paidAmount}>{formatCents(gross)}</Text>
        {settlement.paidByName ? (
          <Text style={styles.paidFrom}>
            {t('qr.paid.from', { name: settlement.paidByName })}
          </Text>
        ) : null}

        <GlassCard style={styles.breakdown}>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>{t('qr.paid.gross')}</Text>
            <Text style={styles.breakdownValue}>{formatCents(gross)}</Text>
          </View>
          {hasSplit ? (
            <>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{t('qr.paid.fee')}</Text>
                <Text style={styles.breakdownValue}>−{formatCents(fee!)}</Text>
              </View>
              <View style={styles.breakdownDivider} />
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabelStrong}>{t('qr.paid.net')}</Text>
                <Text style={styles.breakdownNet}>{formatCents(net!)}</Text>
              </View>
            </>
          ) : null}
          {settlement.reference ? (
            <>
              <View style={styles.breakdownDivider} />
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{t('qr.paid.reference')}</Text>
                <Text style={styles.breakdownValue}>{settlement.reference}</Text>
              </View>
            </>
          ) : null}
        </GlassCard>

        <View style={styles.resultFooter}>
          <PillButton label={t('qr.paid.newSale')} onPress={handleNewSale} />
        </View>
      </DarkScreen>
    );
  }

  // ── Expired ─────────────────────────────────────
  if (phase === 'expired') {
    return (
      <DarkScreen scroll contentStyle={styles.resultContent}>
        <ScreenHeader title={t('qr.expired.title')} subtitle={t('qr.expired.message')} />
        <View style={styles.expiredAmount}>
          <Text style={styles.amountBadgeLabel}>{t('qr.display.amount')}</Text>
          <Text style={styles.amountBadgeValue}>{formatCents(amountCents)}</Text>
        </View>
        <View style={styles.resultFooter}>
          <PillButton
            label={t('qr.expired.regenerate')}
            onPress={handleGenerate}
            loading={loading}
            disabled={offline}
          />
          <PillButton
            label={t('qr.expired.changeAmount')}
            variant="glass"
            onPress={handleEditAmount}
          />
        </View>
      </DarkScreen>
    );
  }

  // ── QR displayed, waiting for the customer ──────
  if (phase === 'showing' && qrData) {
    const warning = timeRemaining < 60;
    return (
      <DarkScreen scroll contentStyle={styles.resultContent}>
        <ScreenHeader title={t('qr.display.readyTitle')} subtitle={t('qr.display.scanSubtitle')} />

        <View style={styles.amountBadge}>
          <Text style={styles.amountBadgeLabel}>{t('qr.display.amount')}</Text>
          <Text style={styles.amountBadgeValue}>{formatCents(amountCents)}</Text>
          {reference.trim() ? (
            <Text style={styles.amountBadgeRef}>{reference.trim()}</Text>
          ) : null}
          <Text style={styles.netLine}>
            {t('qr.display.youReceive', { amount: formatCents(qrData.netCents) })}
          </Text>
        </View>

        <View style={styles.qrFrame}>
          <QRCode value={qrData.qrData} size={QR_SIZE} backgroundColor="#FFFFFF" color="#000000" />
        </View>

        <View style={[styles.timer, warning && styles.timerWarn]}>
          <Text style={[styles.timerValue, warning && styles.timerValueWarn]}>
            {formatTime(timeRemaining)}
          </Text>
          <Text style={styles.timerLabel}>{t('qr.display.expiresIn')}</Text>
        </View>

        <View style={styles.resultFooter}>
          <View style={styles.waitingRow}>
            <View style={styles.waitingDot} />
            <Text style={styles.waitingText}>{t('qr.display.waiting')}</Text>
          </View>
          <PillButton label={t('qr.display.cancelSale')} variant="glass" onPress={handleNewSale} />
        </View>
      </DarkScreen>
    );
  }

  // ── Entry / counter code ────────────────────────
  return (
    <DarkScreen scroll keyboard contentStyle={styles.content}>
      <ScreenHeader
        title={t('qr.receive.title')}
        subtitle={mode === 'charge' ? t('qr.receive.subtitle') : t('qr.counter.subtitle')}
      />

      <View style={styles.segment}>
        {(['charge', 'counter'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segmentBtn, mode === m && styles.segmentBtnActive]}
            onPress={() => {
              setError(null);
              setMode(m);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
              {t(`qr.mode.${m}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {offline ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>{t('qr.offline.banner')}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {mode === 'counter' ? (
        <View style={styles.counterBody}>
          {sticker ? (
            <>
              <View style={styles.qrFrame}>
                <QRCode
                  value={sticker.qrData}
                  size={QR_SIZE}
                  backgroundColor="#FFFFFF"
                  color="#000000"
                  getRef={(c) => {
                    stickerRef.current = c;
                  }}
                />
              </View>
              <Text style={styles.counterName}>{sticker.merchantName}</Text>
              <Text style={styles.counterAddress}>{sticker.businessAddress}</Text>
              <View style={styles.counterFooter}>
                <PillButton label={t('qr.counter.share')} onPress={handleShareSticker} />
                <Text style={styles.infoText}>{t('qr.counter.hint')}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.infoText}>
              {stickerLoading ? t('qr.counter.loading') : t('qr.counter.unavailable')}
            </Text>
          )}
        </View>
      ) : (
        <>
          <View style={styles.body}>
            <Text style={styles.label}>{t('qr.receive.referenceLabel')}</Text>
            <GlassCard style={[styles.refInputCard, refFocused && styles.amountInputCardFocused]}>
              <TextInput
                style={styles.refInput}
                placeholder={t('qr.receive.referencePlaceholder')}
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={reference}
                onChangeText={setReference}
                returnKeyType="next"
                maxLength={40}
                onFocus={() => setRefFocused(true)}
                onBlur={() => setRefFocused(false)}
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
                onChangeText={(v) => setAmount(sanitizeAmountInput(v))}
                keyboardType="decimal-pad"
                autoFocus
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
              disabled={amountCents <= 0 || offline}
            />
            <Text style={styles.infoText}>{t('qr.receive.validityHint')}</Text>
          </View>
        </>
      )}
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
    paddingTop: 12,
    flex: 1,
  },
  counterBody: {
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
    flex: 1,
  },
  footer: {
    paddingHorizontal: 24,
    gap: 14,
  },

  // segmented mode switch
  segment: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginTop: 8,
    padding: 4,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  segmentBtn: {
    flex: 1,
    height: 40,
    borderRadius: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
  },
  segmentTextActive: {
    color: '#000000',
  },

  offlineBanner: {
    marginHorizontal: 24,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,176,32,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,176,32,0.35)',
  },
  offlineText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFB020',
    textAlign: 'center',
  },
  errorBanner: {
    marginHorizontal: 24,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.35)',
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF6961',
    textAlign: 'center',
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
    marginTop: 4,
    marginBottom: 24,
  },
  expiredAmount: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 32,
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
  netLine: {
    fontSize: 13,
    color: TEXT_DIM,
    marginTop: 8,
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
    marginBottom: 24,
  },
  timer: {
    alignItems: 'center',
    backgroundColor: 'rgba(52,199,123,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52,199,123,0.35)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 24,
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
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 4,
  },
  waitingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C77B',
  },
  waitingText: {
    fontSize: 14,
    color: TEXT_DIM,
  },
  resultFooter: {
    alignSelf: 'stretch',
    paddingHorizontal: 24,
    gap: 14,
  },

  // paid
  paidIcon: {
    marginTop: 40,
    marginBottom: 20,
  },
  paidTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  paidAmount: {
    fontSize: 52,
    fontWeight: '800',
    color: '#34C77B',
    letterSpacing: -2,
    marginTop: 8,
  },
  paidFrom: {
    fontSize: 15,
    color: TEXT_DIM,
    marginTop: 6,
    marginBottom: 28,
  },
  breakdown: {
    alignSelf: 'stretch',
    marginHorizontal: 24,
    padding: 18,
    marginBottom: 28,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  breakdownLabel: {
    fontSize: 14,
    color: TEXT_DIM,
  },
  breakdownLabelStrong: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  breakdownValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  breakdownNet: {
    fontSize: 18,
    fontWeight: '800',
    color: '#34C77B',
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 8,
  },

  // counter code
  counterName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  counterAddress: {
    fontSize: 14,
    color: TEXT_DIM,
    marginTop: 4,
    marginBottom: 28,
    textAlign: 'center',
  },
  counterFooter: {
    alignSelf: 'stretch',
    gap: 14,
  },

  infoText: {
    fontSize: 13,
    color: TEXT_DIM,
    textAlign: 'center',
    lineHeight: 19,
  },
});
