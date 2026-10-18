/**
 * Automatic daily payouts (plan 3.6, D11): each evening, everything above the
 * balance the merchant chooses to keep is requested as a payout to the
 * account they give here. Switching it on or off takes the PIN.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Switch, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton, PinInput, ACCENT, TEXT_DIM, TEXT_FAINT } from '../../components';
import { firestore, functions } from '../../services/firebase.config';
import { useAuth } from '../../hooks/useAuth';
import { toCents, formatCents, sanitizeAmountInput } from '../../utils/money';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';

type Route = 'bank' | 'zaad' | 'edahab' | 'cash';
const ROUTES: Route[] = ['bank', 'zaad', 'edahab', 'cash'];

export default function AutoPayoutScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [keep, setKeep] = useState('20');
  const [route, setRoute] = useState<Route>('zaad');
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
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
          if (a.route) setRoute(a.route);
          if (a.destinationName) setName(a.destinationName);
          if (a.destinationRef) setRef(a.destinationRef);
        }
        setMinCents((pricing.data as any)?.data?.autoPayoutMinCents ?? 1000);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [user?.uid]);

  const valid = !enabled || (name.trim().length >= 2 && ref.trim().length >= 3);

  const save = async (enteredPin: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await functions().httpsCallable('setAutoPayout')(
        enabled
          ? { enabled, keepCents: toCents(keep), route, destinationName: name.trim(), destinationRef: ref.trim(), pin: enteredPin }
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
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (pinError) setPinError(null);
          }}
          onComplete={save}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        {saving ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
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
          <ActivityIndicator color="#FFFFFF" style={styles.spinner} />
        ) : (
          <>
            <GlassCard style={styles.toggleCard}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{t('autoPayout.toggle')}</Text>
                <Switch value={enabled} onValueChange={setEnabled} trackColor={{ false: 'rgba(255,255,255,0.15)', true: ACCENT }} thumbColor="#FFFFFF" />
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
                    placeholderTextColor={TEXT_FAINT}
                  />
                </GlassCard>
                <Text style={styles.hint}>{t('autoPayout.keepHint')}</Text>

                <Text style={styles.label}>{t('payout.routeLabel')}</Text>
                <View style={styles.routeRow}>
                  {ROUTES.map((r) => (
                    <TouchableOpacity key={r} style={[styles.routeChip, route === r && styles.routeChipActive]} onPress={() => setRoute(r)}>
                      <Text style={styles.routeText}>{t(`payout.route.${r}`)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>{t('payout.destinationLabel')}</Text>
                <GlassCard>
                  <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t('payout.destinationNamePlaceholder')} placeholderTextColor={TEXT_FAINT} />
                  <View style={styles.divider} />
                  <TextInput
                    style={styles.input}
                    value={ref}
                    onChangeText={setRef}
                    placeholder={route === 'bank' ? t('payout.destinationAccountPlaceholder') : t('payout.destinationPhonePlaceholder')}
                    placeholderTextColor={TEXT_FAINT}
                  />
                </GlassCard>
              </>
            )}

            <PillButton style={styles.save} label={t('autoPayout.save')} disabled={!valid} onPress={() => setPinStep(true)} />
          </>
        )}
      </View>
    </DarkScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6 },
  pinInput: { marginTop: 28 },
  pinError: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  spinner: { marginTop: 20 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  toggleCard: { padding: 16, marginTop: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', flex: 1 },
  label: { fontSize: 12, fontWeight: '700', color: TEXT_FAINT, letterSpacing: 1, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  input: { fontSize: 15, color: '#FFFFFF', padding: 16 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  hint: { fontSize: 12, color: TEXT_FAINT, marginTop: 10, lineHeight: 17 },
  routeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  routeChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  routeChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  routeText: { color: '#FFFFFF', fontWeight: '600' },
  save: { marginTop: 28 },
});
