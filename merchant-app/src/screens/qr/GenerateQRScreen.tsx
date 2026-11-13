import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import QRCode from 'react-native-qrcode-svg';
import { firestore } from '../../services/firebase.config';
import { generateQRCode, cancelQRCode } from '../../services/qr.service';
import { triggerHaptic } from '../../services/haptics.service';
import { QRCodeData, QRSettlement } from '../../types';
import { toCents, formatCents } from '../../utils/money';
import { REFERENCE_MAX_LENGTH } from '../../utils/receiptParser';
import { callableErrorKey } from '../../utils/errors';
import {
  PriorPayment,
  priorPaymentFromError,
  shouldCheckPaidReference,
} from '../../utils/paidReference';
import {
  DarkScreen,
  ScreenHeader,
  GlassCard,
  PillButton,
  AmountKeypad,
  ReceiptScanner,
  PaidReferenceSheet,
  ACCENT,
  TEXT_DIM,
  TEXT_FAINT,
} from '../../components';
import type { ReceiptDetails } from '../../components/ReceiptScanner';
import { ScanIcon, SuccessCheckIcon, ReceiptIcon, CloseIcon, QrIcon } from '../../components/icons/AuthIcons';

type Phase = 'entry' | 'showing' | 'paid' | 'expired';

const TICKET_QR_SIZE = 232;
// Flat, solid surfaces rather than bordered glass.
const SURFACE = '#1C1C1E';
const TEXT_MUTED = '#AEAEB2';

/**
 * The Receive tab. The sale comes first: the amount, and an invoice number
 * or note. Then the shopkeeper picks how to collect it: show a QR for the
 * customer to scan, or scan the customer's own code. Either way the amount
 * and note carry through, and a link under the QR switches to scanning.
 *
 * The shop's own QR, where the customer types the amount, has its own
 * screen (CounterCodeScreen, "My QR"), reached from the top right.
 */
export default function GenerateQRScreen() {
  const { t } = useTranslation();
  const { height: screenHeight } = useWindowDimensions();
  const navigation = useNavigation<any>();

  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [qrData, setQrData] = useState<QRCodeData | null>(null);
  const [settlement, setSettlement] = useState<QRSettlement | null>(null);
  const [phase, setPhase] = useState<Phase>('entry');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [offline, setOffline] = useState(false);

  // Reference + receipt
  const [refEditing, setRefEditing] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  // True while the amount on screen came off a photographed receipt and the
  // merchant hasn't touched it: they are asked to check it before charging.
  const [fromReceipt, setFromReceipt] = useState(false);
  // Kind of the scanned identifier the reference came from ("invoice",
  // "kot"…), or null when it was typed. Decides whether to check it was paid.
  const [referenceKind, setReferenceKind] = useState<string | null>(null);
  // The earlier payment of this reference, while the warning is up.
  const [prior, setPrior] = useState<PriorPayment | null>(null);
  // A reference the merchant chose to charge again for this sale, so showing
  // a fresh code after the first expires doesn't ask a second time.
  const [confirmedReference, setConfirmedReference] = useState<string | null>(null);

  const amountCents = toCents(amount);
  const trimmedReference = reference.trim();

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
              receiptNumber: data.receiptNumber,
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

  // ── Charge flow ─────────────────────────────────
  const handleGenerate = async (chargeAgain = false) => {
    if (amountCents <= 0) {
      setError(t('common.invalidAmountMessage'));
      return;
    }
    const ref = trimmedReference || undefined;
    try {
      setLoading(true);
      setError(null);
      setRefEditing(false);
      const result = await generateQRCode(amountCents, 'USD', ref, {
        checkPaidReference: !!ref && shouldCheckPaidReference(ref, referenceKind),
        confirmPaidReference: chargeAgain || (!!ref && ref === confirmedReference),
      });
      if (chargeAgain && ref) setConfirmedReference(ref);
      setPrior(null);
      setQrData(result);
      setPhase('showing');
    } catch (e: any) {
      const earlier = priorPaymentFromError(e);
      if (earlier) {
        triggerHaptic('medium');
        setPrior(earlier);
      } else {
        setPrior(null);
        setError(t(callableErrorKey(e)));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReferenceChange = (next: string) => {
    setReference(next);
    // Typed by hand now, whatever it started as.
    setReferenceKind(null);
  };

  const handleNewSale = () => {
    // Void an abandoned code so it can't be paid later off a stale screen.
    if (phase === 'showing' && qrData) cancelQRCode(qrData.qrCodeId);
    setQrData(null);
    setSettlement(null);
    setAmount('');
    setReference('');
    setReferenceKind(null);
    setConfirmedReference(null);
    setPrior(null);
    setRefEditing(false);
    setFromReceipt(false);
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

  // The customer can't scan: scan them instead, for the same sale. The code
  // on screen is voided first, so one sale can't be paid both ways.
  const handleScanInstead = () => {
    if (qrData) cancelQRCode(qrData.qrCodeId);
    setQrData(null);
    setTimeRemaining(0);
    setError(null);
    setPhase('entry');
    navigation.navigate('ScanCharge', {
      amountCents,
      reference: trimmedReference || undefined,
    });
  };

  const handleAmountChange = (next: string) => {
    setAmount(next);
    setFromReceipt(false);
    if (error) setError(null);
  };

  // ── Receipt ─────────────────────────────────────
  // The receipt only fills the form in. The merchant still presses the button
  // that shows the code, with the amount in front of them.
  const handleReceipt = (details: ReceiptDetails) => {
    setScannerOpen(false);
    setError(null);
    if (details.amountCents !== null) {
      setAmount((details.amountCents / 100).toFixed(2));
      setFromReceipt(true);
    }
    if (details.reference) {
      setReference(details.reference);
      setReferenceKind(details.referenceKind);
    }
  };

  const paidReferenceSheet = (
    <PaidReferenceSheet
      prior={prior}
      amountCents={amountCents}
      loading={loading}
      onCancel={() => setPrior(null)}
      onChargeAgain={() => handleGenerate(true)}
    />
  );

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

        <View style={styles.breakdown}>
          {settlement.receiptNumber ? (
            <>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{t('qr.paid.receipt')}</Text>
                <Text style={styles.receiptValue} selectable>
                  {settlement.receiptNumber}
                </Text>
              </View>
              <View style={styles.breakdownDivider} />
            </>
          ) : null}
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
        </View>

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
          <Text style={styles.expiredLabel}>{t('qr.display.amount')}</Text>
          <Text style={styles.expiredValue}>{formatCents(amountCents)}</Text>
          {trimmedReference ? <Text style={styles.expiredRef}>{trimmedReference}</Text> : null}
        </View>
        <View style={styles.resultFooter}>
          <PillButton
            label={t('qr.expired.regenerate')}
            onPress={() => handleGenerate()}
            loading={loading}
            disabled={offline}
          />
          <PillButton
            label={t('qr.expired.changeAmount')}
            variant="glass"
            onPress={handleEditAmount}
          />
        </View>
        {paidReferenceSheet}
      </DarkScreen>
    );
  }

  // ── QR displayed, waiting for the customer ──────
  // One white ticket the merchant turns to the customer: who is being paid,
  // how much, what for, and the code — everything the customer will see again
  // on their own phone before they enter their PIN.
  if (phase === 'showing' && qrData) {
    const warning = timeRemaining < 60;
    return (
      <DarkScreen scroll contentStyle={styles.showingContent}>
        <View style={styles.showingHeader}>
          <TouchableOpacity
            style={styles.roundBtn}
            onPress={handleNewSale}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('qr.display.cancelSale')}
          >
            <CloseIcon size={14} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.showingTitle}>{t('qr.display.scanSubtitle')}</Text>
          <View style={styles.roundSpacer} />
        </View>

        <View style={styles.ticket}>
          {qrData.merchantName ? (
            <>
              <Text style={styles.ticketPayTo}>{t('qr.display.payTo')}</Text>
              <Text style={styles.ticketMerchant} numberOfLines={1}>
                {qrData.merchantName}
              </Text>
            </>
          ) : null}
          <Text style={styles.ticketAmount} numberOfLines={1} adjustsFontSizeToFit>
            {formatCents(amountCents)}
          </Text>
          {trimmedReference ? (
            <View style={styles.ticketRef}>
              <Text style={styles.ticketRefText} numberOfLines={1}>
                {trimmedReference}
              </Text>
            </View>
          ) : null}

          <View style={styles.ticketPerforation} />

          <QRCode
            value={qrData.qrData}
            size={TICKET_QR_SIZE}
            backgroundColor="#FFFFFF"
            color="#000000"
          />
          <Text style={styles.ticketHint}>{t('qr.display.payHint')}</Text>
        </View>

        {error ? (
          <View style={[styles.errorBanner, styles.showingBanner]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.statusCard}>
          <ActivityIndicator color={warning ? '#FF6961' : ACCENT} />
          <View style={styles.statusBody}>
            <Text style={styles.statusText}>{t('qr.display.waiting')}</Text>
            <Text style={styles.statusSub}>
              {t('qr.display.youReceive', { amount: formatCents(qrData.netCents) })}
            </Text>
          </View>
          <Text style={[styles.statusTime, warning && styles.statusTimeWarn]}>
            {formatTime(timeRemaining)}
          </Text>
        </View>

        <View style={styles.showingSpacer} />

        <TouchableOpacity
          style={styles.cantScan}
          onPress={handleScanInstead}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <ScanIcon size={18} color="#FFFFFF" />
          <Text style={styles.cantScanText}>{t('qr.display.cantScan')}</Text>
        </TouchableOpacity>
      </DarkScreen>
    );
  }

  // ── Entry ───────────────────────────────────────
  const keyHeight = screenHeight < 700 ? 50 : screenHeight < 820 ? 58 : 66;
  const amountEmpty = amount === '';

  return (
    <DarkScreen scroll keyboard contentStyle={styles.content}>
      <View style={styles.topRow}>
        <Text style={styles.title}>{t('navigation.tabs.receive')}</Text>
        <TouchableOpacity
          style={styles.counterBtn}
          onPress={() => navigation.navigate('CounterCode')}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <QrIcon size={16} color="#FFFFFF" />
          <Text style={styles.counterBtnText}>{t('qr.myQr.title')}</Text>
        </TouchableOpacity>
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

      <>
          {/* Amount */}
          <View style={styles.amountBlock}>
            <Text
              style={[styles.amountText, amountEmpty && styles.amountTextEmpty]}
              numberOfLines={1}
              adjustsFontSizeToFit
              accessibilityLabel={`${t('qr.receive.amountLabel')} ${formatCents(amountCents)}`}
            >
              ${amountEmpty ? '0' : amount}
            </Text>
            <Text style={[styles.amountNote, fromReceipt && styles.amountNoteWarn]}>
              {fromReceipt ? t('qr.receive.checkAmount') : t('qr.receive.amountHint')}
            </Text>
          </View>

          {/* Reference */}
          <View style={styles.refRow}>
            {refEditing ? (
              <GlassCard style={styles.refInputCard}>
                <TextInput
                  style={styles.refInput}
                  placeholder={t('qr.receive.referencePlaceholder')}
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={reference}
                  onChangeText={handleReferenceChange}
                  returnKeyType="done"
                  maxLength={REFERENCE_MAX_LENGTH}
                  autoFocus
                  onSubmitEditing={() => setRefEditing(false)}
                  onBlur={() => setRefEditing(false)}
                />
                <TouchableOpacity
                  onPress={() => setRefEditing(false)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.refDone}>{t('qr.receive.referenceDone')}</Text>
                </TouchableOpacity>
              </GlassCard>
            ) : trimmedReference ? (
              <View style={styles.refChip}>
                <TouchableOpacity
                  style={styles.refChipMain}
                  onPress={() => setRefEditing(true)}
                  activeOpacity={0.7}
                >
                  <ReceiptIcon size={16} color="rgba(255,255,255,0.7)" />
                  <Text style={styles.refChipText} numberOfLines={1}>
                    {trimmedReference}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.refClear}
                  onPress={() => handleReferenceChange('')}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('qr.receive.clearReference')}
                >
                  <CloseIcon size={10} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.refAdd}
                onPress={() => setRefEditing(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.refAddText}>{t('qr.receive.addReference')}</Text>
              </TouchableOpacity>
            )}

            {/* Fills the amount and the reference from a photographed receipt.
                Icon only once a reference is showing, so the two share the row. */}
            {!refEditing ? (
              <TouchableOpacity
                style={[styles.receiptBtn, trimmedReference ? styles.receiptBtnIcon : null]}
                onPress={() => setScannerOpen(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('qr.receive.scanReceipt')}
              >
                <ReceiptIcon size={18} color="#FFFFFF" />
                {trimmedReference ? null : (
                  <Text style={styles.receiptBtnText}>{t('qr.receive.scanReceipt')}</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Keypad gives way to the system keyboard while a reference is typed */}
          {refEditing ? (
            <View style={styles.keypadSpacer} />
          ) : (
            <View style={styles.keypadWrap}>
              <AmountKeypad
                value={amount}
                onChange={handleAmountChange}
                keyHeight={keyHeight}
                deleteLabel={t('qr.receive.delete')}
              />
            </View>
          )}

          <View style={styles.footer}>
            {/* The sale is typed; now how to collect it. */}
            <PillButton
              label={t('qr.receive.scanCustomer')}
              variant="glass"
              style={styles.footerBtn}
              onPress={handleScanInstead}
              disabled={amountCents <= 0 || offline || loading}
            />
            <PillButton
              label={t('qr.receive.showQr')}
              style={styles.footerBtn}
              onPress={() => handleGenerate()}
              loading={loading}
              disabled={amountCents <= 0 || offline}
            />
          </View>
      </>

      <ReceiptScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onApply={handleReceipt}
      />
      {paidReferenceSheet}
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 16,
  },
  resultContent: {
    paddingBottom: 40,
    alignItems: 'center',
  },
  showingContent: {
    paddingTop: 12,
    paddingBottom: 28,
    alignItems: 'center',
  },

  // top row
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  counterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: SURFACE,
  },
  counterBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },

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
  showingBanner: {
    alignSelf: 'stretch',
    marginTop: 0,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF6961',
    textAlign: 'center',
  },

  // amount
  amountBlock: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
    minHeight: 112,
  },
  amountText: {
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: -2.5,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  amountTextEmpty: {
    color: 'rgba(255,255,255,0.28)',
  },
  amountNote: {
    fontSize: 13,
    color: TEXT_FAINT,
    marginTop: 4,
    textAlign: 'center',
  },
  amountNoteWarn: {
    color: '#FFB020',
    fontWeight: '600',
  },

  // reference
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    minHeight: 48,
    justifyContent: 'center',
    gap: 10,
  },
  receiptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: SURFACE,
  },
  receiptBtnIcon: {
    width: 40,
    paddingHorizontal: 0,
  },
  receiptBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  refAdd: {
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 20,
    justifyContent: 'center',
    backgroundColor: SURFACE,
  },
  refAddText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
  refChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    height: 40,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 20,
    backgroundColor: SURFACE,
    gap: 10,
  },
  refChipMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  refChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    flexShrink: 1,
  },
  refClear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refInputCard: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    height: 48,
    gap: 12,
    borderColor: ACCENT,
  },
  refInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    padding: 0,
  },
  refDone: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // keypad
  keypadWrap: {
    paddingTop: 8,
  },
  keypadSpacer: {
    height: 24,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  footerBtn: { flex: 1 },

  // ticket (customer-facing)
  ticket: {
    alignSelf: 'stretch',
    marginHorizontal: 20,
    marginBottom: 16,
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  ticketPayTo: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.5)',
  },
  ticketMerchant: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: '#000000',
    marginTop: 2,
  },
  ticketAmount: {
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -2,
    color: '#000000',
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  ticketRef: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.06)',
    maxWidth: '100%',
  },
  ticketRefText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.7)',
  },
  ticketPerforation: {
    alignSelf: 'stretch',
    marginTop: 18,
    marginBottom: 18,
    borderTopWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.14)',
    borderStyle: 'dashed',
  },
  ticketHint: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.6)',
    textAlign: 'center',
    marginTop: 16,
  },
  showingHeader: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 18,
  },
  showingTitle: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: SURFACE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roundSpacer: { width: 44, height: 44 },
  statusCard: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: SURFACE,
  },
  statusBody: { flex: 1, gap: 2 },
  statusText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  statusSub: { fontSize: 13, color: TEXT_MUTED },
  statusTime: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_MUTED,
    fontVariant: ['tabular-nums'],
  },
  statusTimeWarn: {
    color: '#FF6961',
  },
  showingSpacer: { flexGrow: 1, minHeight: 12 },
  cantScan: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 20,
  },
  cantScanText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },

  // expired
  expiredAmount: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
  expiredLabel: {
    fontSize: 13,
    color: TEXT_FAINT,
    marginBottom: 4,
  },
  expiredValue: {
    fontSize: 44,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -2,
  },
  expiredRef: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 6,
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
    fontSize: 17,
    fontWeight: '600',
    color: '#30D158',
  },
  paidAmount: {
    fontSize: 64,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -2.5,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  paidFrom: {
    fontSize: 17,
    color: TEXT_MUTED,
    marginTop: 4,
    marginBottom: 28,
  },
  receiptValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  breakdown: {
    alignSelf: 'stretch',
    marginHorizontal: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: SURFACE,
    marginBottom: 24,
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
    fontWeight: '700',
    color: '#30D158',
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 8,
  },

});
