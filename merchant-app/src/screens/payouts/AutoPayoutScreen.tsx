/**
 * Automatic daily payouts (plan 3.6, D11): each evening, everything above the
 * balance the merchant chooses to keep is requested as a payout to their
 * Zaad account on file. Switching it on or off takes the PIN.
 *
 * Shillings are their own opt-in with their own balance to keep, paid out
 * as shillings, never converted (SHILLINGS.md).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, Switch, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton, PinInput } from '../../components';
import { firestore, functions } from '../../services/firebase.config';
import { useAuth } from '../../hooks/useAuth';
import { useMerchantProfile } from '../../hooks/useMerchantProfile';
import { toCents, formatCents, sanitizeAmountFor, sanitizeAmountInput, toAmount } from '../../utils/money';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';
import { ZaadDestination } from './ZaadDestination';
import { makeStyles, useColors } from '../../theme';

export default function AutoPayoutScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const zaad = useMerchantProfile().profile?.zaad;

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [keep, setKeep] = useState('20');
  const [slsEnabled, setSlsEnabled] = useState(false);
  const [keepSls, setKeepSls] = useState('0');
  const [minCents, setMinCents] = useState(1000);
  const [pinStep, setPinStep] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    Promise.all([
      firestore().collection('merchantProfiles').doc(user.uid).get(),
      functions().httpsCallable('getPricing')(),
    ])
      .then(([profile, pricing]) => {
        const a = profile.data()?.autoPayout;
        if (a) {
          setEnabled(!!a.enabled);
          if (typeof a.keepCents === 'number') setKeep((a.keepCents / 100).toFixed(2));
          if (a.shillings) {
            setSlsEnabled(!!a.shillings.enabled);
            if (typeof a.shillings.keep === 'number') setKeepSls(String(a.shillings.keep));
          }
        }
        setMinCents((pricing.data as any)?.data?.autoPayoutMinCents ?? 1000);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [user?.uid]);

  const valid = !enabled || !!zaad;

  const save = async (enteredPin: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await functions().httpsCallable('setAutoPayout')(
        enabled
          ? {
              enabled,
              keepCents: toCents(keep),
              shillingsEnabled: slsEnabled,
              keepSls: toAmount(keepSls, 'SLS'),
              pin: enteredPin,
            }
          : { enabled, pin: enteredPin }
      );
      setPinStep(false);
      Alert.alert(t('common.success'), enabled ? t('autoPayout.savedOn') : t('autoPayout.savedOff'), [
        { text: t('common.ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      if (isWrongPin(e)) setPinError(t('errors.wrongPin'));
      else {
        setPinStep(false);
        Alert.alert(t('common.error'), t(pinActionErrorKey(e)));
      }
    } finally {
      setPin('');
      setSaving(false);
    }
  };

  if (pinStep) {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('payout.pinTitle')}</Text>
        <Text style={styles.sub}>{enabled ? t('autoPayout.pinOn') : t('autoPayout.pinOff')}</Text>
        <PinInput
          autoFocus
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (pinError) setPinError(null);
          }}
          onComplete={save}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        {saving ? <ActivityIndicator color={colors.ui.text} style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton label={t('common.cancel')} variant="glass" onPress={() => setPinStep(false)} disabled={saving} />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll keyboard>
      <ScreenHeader title={t('autoPayout.title')} onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.ui.text} style={styles.spinner} />
        ) : (
          <>
            <GlassCard style={styles.toggleCard}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{t('autoPayout.toggle')}</Text>
                <Switch value={enabled} onValueChange={setEnabled} trackColor={{ false: colors.ui.ink(0.15), true: colors.ui.accent }} thumbColor={colors.ui.text} />
              </View>
              <Text style={styles.hint}>{t('autoPayout.explain', { min: formatCents(minCents) })}</Text>
            </GlassCard>

            {enabled && (
              <>
                <Text style={styles.label}>{t('autoPayout.keepLabel')}</Text>
                <GlassCard>
                  <TextInput
                    style={styles.input}
                    value={keep}
                    onChangeText={(v) => setKeep(sanitizeAmountInput(v))}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.ui.textFaint}
                  />
                </GlassCard>
                <Text style={styles.hint}>{t('autoPayout.keepHint')}</Text>

                <GlassCard style={[styles.toggleCard, styles.slsCard]}>
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>{t('autoPayout.shillingsToggle')}</Text>
                    <Switch
                      value={slsEnabled}
                      onValueChange={setSlsEnabled}
                      trackColor={{ false: colors.ui.ink(0.15), true: colors.ui.accent }}
                      thumbColor={colors.ui.text}
                    />
                  </View>
                  <Text style={styles.hint}>{t('autoPayout.shillingsHint')}</Text>
                </GlassCard>
                {slsEnabled && (
                  <>
                    <Text style={styles.label}>{t('autoPayout.keepSlsLabel')}</Text>
                    <GlassCard>
                      <TextInput
                        style={styles.input}
                        value={keepSls}
                        onChangeText={(v) => setKeepSls(sanitizeAmountFor(v, 'SLS'))}
                        keyboardType="number-pad"
                        placeholderTextColor={colors.ui.textFaint}
                      />
                    </GlassCard>
                  </>
                )}

                <ZaadDestination zaad={zaad} />
              </>
            )}

            <PillButton style={styles.save} label={t('autoPayout.save')} disabled={!valid} onPress={() => setPinStep(true)} />
          </>
        )}
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: colors.ui.text, textAlign: 'center' },
  sub: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center', marginTop: 6 },
  pinInput: { marginTop: 28 },
  pinError: { fontSize: 14, color: colors.ui.error, textAlign: 'center', marginTop: 16 },
  spinner: { marginTop: 20 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  toggleCard: { padding: 16, marginTop: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { fontSize: 16, fontWeight: '600', color: colors.ui.text, flex: 1 },
  label: { fontSize: 12, fontWeight: '700', color: colors.ui.textFaint, letterSpacing: 1, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  input: { fontSize: 15, color: colors.ui.text, padding: 16 },
  hint: { fontSize: 12, color: colors.ui.textFaint, marginTop: 10, lineHeight: 17 },
  save: { marginTop: 28 },
  slsCard: { marginTop: 20 },
}));
