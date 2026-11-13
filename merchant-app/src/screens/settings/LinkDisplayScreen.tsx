import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton, PinInput, ACCENT, TEXT_DIM } from '../../components';
import { CodeSheet, QrScannerView, ScannerButton } from '../../components/QrScannerView';
import { SuccessCheckIcon, CloseIcon } from '../../components/icons/AuthIcons';
import { triggerHaptic } from '../../services/haptics.service';
import { linkDisplay, listMyDisplays, parsePairingCode, PairingCode } from '../../services/counterDisplay.service';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';

const POLL_MS = 2000;
const CONFIRM_WAIT_MS = 2 * 60 * 1000;

type Step =
  | { kind: 'scan' }
  | { kind: 'name'; pairing: PairingCode }
  | { kind: 'pin'; pairing: PairingCode; name: string }
  | { kind: 'confirm'; displayId: string; shop: string }
  | { kind: 'linked' }
  | { kind: 'declined' }
  | { kind: 'notYet' };

/** Where a refused link sends the person, and what it tells them. */
function linkError(err: any): { key: string; backTo: 'scan' | 'pin' } {
  if (isWrongPin(err)) return { key: 'errors.wrongPin', backTo: 'pin' };
  switch (err?.details?.reason) {
    case 'display_code_not_found':
      return { key: 'counterDisplay.errors.codeNotFound', backTo: 'scan' };
    case 'display_code_ambiguous':
      return { key: 'counterDisplay.errors.ambiguous', backTo: 'scan' };
    case 'display_limit':
      return { key: 'counterDisplay.errors.limit', backTo: 'scan' };
    case 'display_code_attempts':
      return { key: 'counterDisplay.errors.tooManyCodes', backTo: 'scan' };
  }
  if (err?.code === 'functions/permission-denied' && /shops/i.test(err?.message ?? '')) {
    return { key: 'counterDisplay.errors.notShop', backTo: 'scan' };
  }
  return { key: pinActionErrorKey(err), backTo: 'pin' };
}

/**
 * Settings → Counter display → Link a screen. Scan the tablet's code (or
 * type it), name the screen, confirm with the PIN, then the owner taps Yes on
 * the tablet, which shows this shop's name. The tablet must be confirmed
 * there: its code is on a public screen, and the confirm step is what stops
 * someone else's shop being linked to it.
 */
export default function LinkDisplayScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const [scanError, setScanError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [name, setName] = useState(t('counterDisplay.defaultName'));
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [sending, setSending] = useState(false);
  const handled = useRef(false);

  const takeCode = useCallback(
    (raw: string) => {
      if (handled.current) return;
      const pairing = parsePairingCode(raw);
      if (!pairing) {
        setScanError(t('counterDisplay.notAScreenCode'));
        return;
      }
      handled.current = true;
      triggerHaptic('medium');
      setScanError(null);
      setStep({ kind: 'name', pairing });
    },
    [t]
  );

  const submit = async (pairing: PairingCode, screenName: string, entered: string) => {
    setSending(true);
    try {
      const res = await linkDisplay({ ...pairing, name: screenName, pin: entered });
      setStep({ kind: 'confirm', displayId: res.displayId, shop: res.merchantName });
    } catch (err: any) {
      const { key, backTo } = linkError(err);
      if (backTo === 'pin') {
        setPinError(t(key));
      } else {
        // Back to the scanner with the reason in red: a new code, or nothing more to do.
        handled.current = false;
        setScanError(t(key));
        setStep({ kind: 'scan' });
      }
    } finally {
      setPin('');
      setSending(false);
    }
  };

  // Waiting for Yes on the tablet: the display turns active, or disappears on No.
  useEffect(() => {
    if (step.kind !== 'confirm') return;
    const started = Date.now();
    let stopped = false;
    const poll = async () => {
      try {
        const displays = await listMyDisplays();
        if (stopped) return;
        const mine = displays.find((d) => d.displayId === step.displayId);
        if (!mine) {
          setStep({ kind: 'declined' });
        } else if (mine.status === 'active') {
          triggerHaptic('payment');
          setStep({ kind: 'linked' });
        } else if (Date.now() - started > CONFIRM_WAIT_MS) {
          setStep({ kind: 'notYet' });
        }
      } catch {
        /* keep waiting; the next poll tries again */
      }
    };
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [step]);

  if (step.kind === 'scan') {
    return (
      <>
        <QrScannerView
          title={t('counterDisplay.scanTitle')}
          hint={t('counterDisplay.scanHint')}
          onScan={takeCode}
          onClose={() => navigation.goBack()}
          closeIcon="back"
          scanning={!typing}
          error={scanError}
          onDismissError={() => setScanError(null)}
        >
          <ScannerButton link label={t('counterDisplay.typeCode')} onPress={() => setTyping(true)} />
        </QrScannerView>
        <CodeSheet
          visible={typing}
          title={t('counterDisplay.codeTitle')}
          value={typed}
          onChangeText={(v) => setTyped(v.replace(/[^0-9]/g, '').slice(0, 8))}
          placeholder="12345678"
          submitLabel={t('common.continue')}
          onSubmit={() => {
            setTyping(false);
            takeCode(typed);
          }}
          onClose={() => setTyping(false)}
          submitDisabled={typed.length !== 8}
          keyboardType="number-pad"
          maxLength={8}
          digits
        />
      </>
    );
  }

  if (step.kind === 'name') {
    return (
      <DarkScreen keyboard edges={['top', 'bottom']}>
        <ScreenHeader
          title={t('counterDisplay.nameTitle')}
          subtitle={t('counterDisplay.nameHint')}
          onBack={() => {
            handled.current = false;
            setStep({ kind: 'scan' });
          }}
        />
        <View style={styles.body}>
          <GlassCard style={styles.card}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              maxLength={40}
              autoFocus
              selectTextOnFocus
              returnKeyType="next"
              placeholderTextColor="rgba(255,255,255,0.25)"
              onSubmitEditing={() => name.trim() && setStep({ kind: 'pin', pairing: step.pairing, name: name.trim() })}
            />
          </GlassCard>
          <PillButton
            label={t('common.continue')}
            disabled={!name.trim()}
            onPress={() => setStep({ kind: 'pin', pairing: step.pairing, name: name.trim() })}
          />
        </View>
      </DarkScreen>
    );
  }

  if (step.kind === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('counterDisplay.pinTitle')}</Text>
        <Text style={styles.sub}>{t('counterDisplay.pinSubtitle')}</Text>
        <PinInput
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError('');
          }}
          onComplete={(entered) => submit(step.pairing, step.name, entered)}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.error}>{pinError}</Text> : null}
        {sending ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton label={t('common.cancel')} variant="glass" disabled={sending} onPress={() => navigation.goBack()} />
        </View>
      </DarkScreen>
    );
  }

  if (step.kind === 'confirm') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <ActivityIndicator size="large" color={ACCENT} style={styles.spinner} />
        <Text style={styles.bigTitle}>{t('counterDisplay.confirmTitle')}</Text>
        <Text style={styles.sub}>{t('counterDisplay.confirmMessage', { shop: step.shop })}</Text>
        <View style={styles.block}>
          <PillButton label={t('common.close')} variant="glass" onPress={() => navigation.goBack()} />
        </View>
      </DarkScreen>
    );
  }

  const outcome = {
    linked: { title: t('counterDisplay.linked'), message: t('counterDisplay.linkedMessage') },
    declined: { title: t('counterDisplay.declined'), message: t('counterDisplay.declinedMessage') },
    notYet: { title: t('counterDisplay.notYet'), message: t('counterDisplay.notYetMessage') },
  }[step.kind];

  return (
    <DarkScreen edges={[]} contentStyle={styles.centered}>
      {step.kind === 'linked' ? (
        <SuccessCheckIcon size={72} />
      ) : (
        <View style={styles.failIcon}>
          <CloseIcon size={32} color="#FF6961" />
        </View>
      )}
      <Text style={styles.bigTitle}>{outcome.title}</Text>
      <Text style={styles.sub}>{outcome.message}</Text>
      <View style={styles.block}>
        <PillButton label={t('common.done')} onPress={() => navigation.goBack()} />
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 20, marginTop: 8 },
  card: { paddingHorizontal: 16, paddingVertical: 4 },
  input: { fontSize: 18, fontWeight: '600', color: '#FFFFFF', paddingVertical: 14 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  bigTitle: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', marginTop: 16 },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  pinInput: { marginTop: 32 },
  error: { fontSize: 14, color: '#FF6961', marginTop: 16, textAlign: 'center' },
  spinner: { marginTop: 16 },
  block: { alignSelf: 'stretch', marginTop: 32 },
  failIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,105,97,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
