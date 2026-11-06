import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton, PinInput, TEXT_DIM, TEXT_FAINT } from '../../components';
import { useToast } from '../../components/auth';
import { useMerchantProfile } from '../../hooks/useMerchantProfile';
import { saveZaadAccount } from '../../services/zaadAccount.service';
import { confirmSignOut } from '../../utils/confirmSignOut';
import { isWrongPin } from '../../utils/errors';
import { formatLocal, normaliseSomaliMsisdn, normaliseZaadName } from '../../utils/zaad';

interface FormProps {
  /** Shown before the app by ZaadGate: no way back, only out. */
  gate?: boolean;
  /** The account on file; changing it takes the PIN. */
  current?: { msisdn: string; name: string };
  phoneNumber?: string;
  onBack?: () => void;
  onSaved?: () => void;
}

/**
 * The Zaad number the merchant or agent uses and the name it's registered
 * to (functions/src/auth/zaadAccount.ts). Payouts go only there. Everyone
 * gives it once; changing it later, from Settings, takes the PIN, and
 * payouts wait a day after a new number.
 */
export function ZaadAccountForm({ gate = false, current, phoneNumber, onBack, onSaved }: FormProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  // Most people's Zaad is the Telesom number they signed up with.
  const [numberText, setNumberText] = useState(() =>
    current ? formatLocal(current.msisdn) : phoneNumber?.startsWith('+25263') ? formatLocal(phoneNumber) : '',
  );
  const [nameText, setNameText] = useState(current?.name ?? '');
  const [numberError, setNumberError] = useState('');
  const [nameError, setNameError] = useState('');
  const [pending, setPending] = useState<{ msisdn: string; name: string } | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (input: { msisdn: string; name: string; pin?: string }) => {
    setSaving(true);
    try {
      await saveZaadAccount(input);
      showToast(t('zaadAccount.saved'), 'success');
      onSaved?.();
    } catch (err: any) {
      if (input.pin && isWrongPin(err)) {
        setPinError(t('errors.wrongPin'));
      } else {
        setPending(null);
        showToast(t('zaadAccount.failed'), 'error');
      }
    } finally {
      setPin('');
      setSaving(false);
    }
  };

  const handleContinue = () => {
    const msisdn = normaliseSomaliMsisdn(numberText);
    const name = normaliseZaadName(nameText);
    setNumberError(msisdn ? '' : t('zaadAccount.invalidNumber'));
    setNameError(name ? '' : t('zaadAccount.invalidName'));
    if (!msisdn || !name) return;
    if (current?.msisdn === msisdn && current?.name === name) {
      onSaved?.();
    } else if (current) {
      setPending({ msisdn, name });
    } else {
      save({ msisdn, name });
    }
  };

  if (pending) {
    const newNumber = pending.msisdn !== current?.msisdn;
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('zaadAccount.pinTitle')}</Text>
        <Text style={styles.sub}>
          {newNumber ? t('zaadAccount.pinSubtitleNewNumber') : t('zaadAccount.pinSubtitle')}
        </Text>
        <PinInput
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError('');
          }}
          onComplete={(entered) => save({ ...pending, pin: entered })}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.error}>{pinError}</Text> : null}
        {saving ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton
            label={t('common.cancel')}
            variant="glass"
            disabled={saving}
            onPress={() => {
              setPending(null);
              setPin('');
              setPinError('');
            }}
          />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll keyboard edges={['top', 'bottom']}>
      <ScreenHeader
        title={t(gate ? 'zaadAccount.gateTitle' : 'zaadAccount.title')}
        subtitle={t('zaadAccount.subtitle')}
        onBack={gate ? undefined : onBack}
      />
      <View style={styles.body}>
        <Text style={styles.label}>{t('zaadAccount.numberLabel')}</Text>
        <GlassCard style={styles.card}>
          <TextInput
            style={styles.input}
            value={numberText}
            onChangeText={(text) => {
              setNumberText(text);
              if (numberError) setNumberError('');
            }}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            placeholder="063 412 3456"
            placeholderTextColor="rgba(255,255,255,0.25)"
          />
        </GlassCard>
        {numberError ? <Text style={styles.fieldError}>{numberError}</Text> : null}

        <Text style={styles.label}>{t('zaadAccount.nameLabel')}</Text>
        <GlassCard style={styles.card}>
          <TextInput
            style={styles.input}
            value={nameText}
            onChangeText={(text) => {
              setNameText(text);
              if (nameError) setNameError('');
            }}
            autoCapitalize="words"
            autoCorrect={false}
            placeholder={t('zaadAccount.namePlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.25)"
          />
        </GlassCard>
        {nameError ? <Text style={styles.fieldError}>{nameError}</Text> : null}
        <Text style={styles.hint}>{t('zaadAccount.nameHint')}</Text>

        <PillButton
          label={t(current ? 'zaadAccount.save' : 'common.continue')}
          onPress={handleContinue}
          loading={saving}
          disabled={saving}
        />
        {gate ? (
          <TouchableOpacity style={styles.signOut} onPress={() => confirmSignOut(t)}>
            <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </DarkScreen>
  );
}

/**
 * Stands in front of the app until the account has a Zaad account on file,
 * as ConsentGate does for the terms. If the profile can't be read (offline),
 * the app is let through rather than shut.
 */
export function ZaadGate({ children }: { children: React.ReactNode }) {
  const { profile, error } = useMerchantProfile();
  if (error) return <>{children}</>;
  if (!profile) return null;
  if (profile.zaad) return <>{children}</>;
  return <ZaadAccountForm gate phoneNumber={profile.phoneNumber} />;
}

/** Settings → Zaad account, and Withdraw → Change. */
export default function ZaadAccountScreen() {
  const navigation = useNavigation<any>();
  const { profile } = useMerchantProfile();
  if (!profile) {
    return (
      <DarkScreen contentStyle={styles.centered}>
        <ActivityIndicator color="#FFFFFF" />
      </DarkScreen>
    );
  }
  return (
    <ZaadAccountForm
      current={profile.zaad}
      phoneNumber={profile.phoneNumber}
      onBack={() => navigation.goBack()}
      onSaved={() => navigation.goBack()}
    />
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48, gap: 6 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5, textAlign: 'center' },
  sub: { fontSize: 15, color: TEXT_DIM, textAlign: 'center', marginTop: 6, lineHeight: 21 },
  pinInput: { marginTop: 28 },
  spinner: { marginTop: 20 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: TEXT_FAINT,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  card: { padding: 0, marginBottom: 4 },
  input: { fontSize: 17, color: '#FFFFFF', padding: 16 },
  fieldError: { fontSize: 12, color: '#FF6961', marginTop: 2 },
  error: { fontSize: 14, color: '#FF6961', textAlign: 'center', marginTop: 16 },
  hint: { fontSize: 12, color: TEXT_FAINT, marginVertical: 12, lineHeight: 17 },
  signOut: { alignItems: 'center', paddingVertical: 20 },
  signOutText: { fontSize: 15, fontWeight: '600', color: TEXT_DIM },
});
