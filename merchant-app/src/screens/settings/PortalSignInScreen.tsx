import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, GlassCard, PillButton, PinInput } from '../../components';
import { QrScannerView } from '../../components/QrScannerView';
import { SuccessCheckIcon, CloseIcon } from '../../components/icons/AuthIcons';
import { triggerHaptic } from '../../services/haptics.service';
import {
  approvePortalLogin,
  declinePortalLogin,
  describePortalLogin,
  parsePortalLogin,
  PortalLoginCode,
} from '../../services/portal.service';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';
import { ZAPP_BUSINESS_URL } from './ZappBusinessScreen';
import { makeStyles, useColors } from '../../theme';

type Step =
  | { kind: 'scan' }
  | { kind: 'checking' }
  | { kind: 'confirm'; login: PortalLoginCode; browser: string }
  | { kind: 'pin'; login: PortalLoginCode; browser: string }
  | { kind: 'done'; browser: string }
  | { kind: 'declined' };

/**
 * Settings → Zapp Business → Sign in on a computer. Scan the code on the
 * computer, check which browser is asking, then the PIN. The computer can
 * then view the shop's figures; it can never move money.
 *
 * The browser check is there because a sign-in QR can be relayed: someone
 * could show this shop a code from their own computer. Approve only a
 * computer in front of you, now.
 */
export default function PortalSignInScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const [scanError, setScanError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [sending, setSending] = useState(false);
  const handled = useRef(false);

  const backToScan = (message: string | null) => {
    handled.current = false;
    setScanError(message);
    setStep({ kind: 'scan' });
  };

  const takeCode = useCallback(
    async (raw: string) => {
      if (handled.current) return;
      const login = parsePortalLogin(raw);
      if (!login) {
        setScanError(t('portal.notACode'));
        return;
      }
      handled.current = true;
      triggerHaptic('medium');
      setScanError(null);
      setStep({ kind: 'checking' });
      try {
        const { browser } = await describePortalLogin(login);
        setStep({ kind: 'confirm', login, browser });
      } catch (err: any) {
        backToScan(err?.details?.reason === 'portal_not_shop' ? t('portal.notShop') : t('portal.codeExpired'));
      }
    },
    [t]
  );

  const decline = async (login: PortalLoginCode) => {
    try {
      await declinePortalLogin(login);
    } catch {
      /* the code may have run out already; either way nothing signs in */
    }
    setStep({ kind: 'declined' });
  };

  const approve = async (login: PortalLoginCode, browser: string, entered: string) => {
    setSending(true);
    try {
      await approvePortalLogin(login, entered);
      triggerHaptic('payment');
      setStep({ kind: 'done', browser });
    } catch (err: any) {
      if (err?.details?.reason === 'portal_login_not_found') backToScan(t('portal.codeExpired'));
      else setPinError(t(isWrongPin(err) ? 'errors.wrongPin' : pinActionErrorKey(err)));
    } finally {
      setPin('');
      setSending(false);
    }
  };

  if (step.kind === 'scan') {
    return (
      <QrScannerView
        title={t('portal.scanTitle')}
        hint={t('portal.scanHint', { url: ZAPP_BUSINESS_URL })}
        onScan={takeCode}
        onClose={() => navigation.goBack()}
        closeIcon="back"
        scanning
        error={scanError}
        onDismissError={() => setScanError(null)}
      />
    );
  }

  if (step.kind === 'checking') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <ActivityIndicator size="large" color={colors.ui.text} />
      </DarkScreen>
    );
  }

  if (step.kind === 'confirm') {
    return (
      <DarkScreen edges={['top', 'bottom']} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('portal.confirmTitle')}</Text>
        <GlassCard style={styles.browserCard}>
          <Text style={styles.browser}>{step.browser}</Text>
          <Text style={styles.browserSub}>{t('portal.confirmWhat')}</Text>
        </GlassCard>
        <Text style={styles.warning}>{t('portal.confirmWarning')}</Text>
        <View style={styles.block}>
          <PillButton label={t('portal.confirmYes')} onPress={() => setStep({ kind: 'pin', login: step.login, browser: step.browser })} />
          <View style={styles.gap} />
          <PillButton label={t('portal.confirmNo')} variant="glass" onPress={() => decline(step.login)} />
        </View>
      </DarkScreen>
    );
  }

  if (step.kind === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('portal.pinTitle')}</Text>
        <Text style={styles.sub}>{t('portal.pinSubtitle', { browser: step.browser })}</Text>
        <PinInput
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError('');
          }}
          onComplete={(entered) => approve(step.login, step.browser, entered)}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.error}>{pinError}</Text> : null}
        {sending ? <ActivityIndicator color={colors.ui.text} style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton label={t('common.cancel')} variant="glass" disabled={sending} onPress={() => decline(step.login)} />
        </View>
      </DarkScreen>
    );
  }

  const ok = step.kind === 'done';
  return (
    <DarkScreen edges={[]} contentStyle={styles.centered}>
      {ok ? (
        <SuccessCheckIcon size={72} />
      ) : (
        <View style={styles.failIcon}>
          <CloseIcon size={32} color={colors.ui.error} />
        </View>
      )}
      <Text style={styles.bigTitle}>{ok ? t('portal.doneTitle') : t('portal.declinedTitle')}</Text>
      <Text style={styles.sub}>{ok ? t('portal.doneMessage', { browser: step.browser }) : t('portal.declinedMessage')}</Text>
      <View style={styles.block}>
        <PillButton label={t('common.done')} onPress={() => navigation.goBack()} />
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  bigTitle: { fontSize: 24, fontWeight: '700', color: colors.ui.text, textAlign: 'center', marginTop: 16 },
  sub: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  browserCard: { alignSelf: 'stretch', padding: 20, marginTop: 24, alignItems: 'center' },
  browser: { fontSize: 20, fontWeight: '700', color: colors.ui.text },
  browserSub: { fontSize: 14, color: colors.ui.textDim, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  warning: { fontSize: 14, color: colors.ui.warning, textAlign: 'center', lineHeight: 20, marginTop: 20 },
  pinInput: { marginTop: 32 },
  error: { fontSize: 14, color: colors.ui.error, marginTop: 16, textAlign: 'center' },
  spinner: { marginTop: 16 },
  block: { alignSelf: 'stretch', marginTop: 32 },
  gap: { height: 12 },
  failIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.ui.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
