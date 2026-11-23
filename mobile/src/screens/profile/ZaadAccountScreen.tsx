import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from '../../components/SafeAreaView';
import { AuthLayout, AuthHeader, useToast } from '../../components/auth';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { PinKeypad } from '../../components/PinKeypad';
import { useUserProfile } from '../../hooks/useUserProfile';
import { signOut } from '../../services/auth.service';
import { saveZaadAccount } from '../../services/zaadAccount.service';
import { formatLocal, normaliseSomaliMsisdn, normaliseZaadName } from '../../services/mobileMoney.utils';
import { typography, spacing, makeStyles, useColors } from '../../theme';

interface FormProps {
  /** Shown before the app by ZaadGate: no way back, only out. */
  gate?: boolean;
  /** The account on file; changing it takes the PIN. */
  current?: { msisdn: string; name: string };
  phoneNumber?: string;
  fullName?: string;
  onBack?: () => void;
  onSaved?: () => void;
}

/**
 * The Zaad number the customer uses and the name it's registered to
 * (functions/src/auth/zaadAccount.ts). Everyone gives it once; changing it
 * later, from Profile, takes the PIN.
 */
export function ZaadAccountForm({ gate = false, current, phoneNumber, fullName, onBack, onSaved }: FormProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { showToast } = useToast();
  // Most people's Zaad is the Telesom number they signed up with.
  const [numberText, setNumberText] = useState(() =>
    current ? formatLocal(current.msisdn) : phoneNumber?.startsWith('+25263') ? formatLocal(phoneNumber) : '',
  );
  const [nameText, setNameText] = useState(current?.name ?? fullName ?? '');
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
      if (input.pin && err?.code === 'functions/permission-denied') {
        setPin('');
        setPinError(t('zaadAccount.wrongPin'));
      } else {
        setPending(null);
        setPin('');
        showToast(t('zaadAccount.failed'), 'error');
      }
    } finally {
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
    return (
      <SafeAreaView style={styles.fullScreen}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            setPending(null);
            setPin('');
            setPinError('');
          }}
          accessibilityLabel={t('common.back')}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <PinKeypad
          value={pin}
          onChange={(next) => {
            setPin(next);
            if (pinError) setPinError('');
          }}
          onComplete={saving ? undefined : (entered) => save({ ...pending, pin: entered })}
          title={t('zaadAccount.pinTitle')}
          subtitle={t('zaadAccount.pinSubtitle')}
          error={pinError}
        />
      </SafeAreaView>
    );
  }

  return (
    <AuthLayout onBack={gate ? undefined : onBack}>
      <AuthHeader
        title={t(gate ? 'zaadAccount.gateTitle' : 'zaadAccount.title')}
        subtitle={t('zaadAccount.subtitle')}
        centered={false}
      />
      <Input
        label={t('zaadAccount.numberLabel')}
        placeholder="063 412 3456"
        value={numberText}
        onChangeText={(text) => {
          setNumberText(text);
          if (numberError) setNumberError('');
        }}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        error={numberError}
      />
      <Input
        label={t('zaadAccount.nameLabel')}
        placeholder={t('zaadAccount.namePlaceholder')}
        value={nameText}
        onChangeText={(text) => {
          setNameText(text);
          if (nameError) setNameError('');
        }}
        autoCapitalize="words"
        autoCorrect={false}
        error={nameError}
      />
      <Text style={styles.hint}>{t('zaadAccount.nameHint')}</Text>
      <Button
        title={t(current ? 'zaadAccount.save' : 'common.continue')}
        onPress={handleContinue}
        loading={saving}
        variant="gradient"
        fullWidth
        style={styles.button}
      />
      {gate ? (
        <TouchableOpacity style={styles.signOut} onPress={() => signOut().catch(() => undefined)}>
          <Text style={styles.signOutText}>{t('profile.logOut')}</Text>
        </TouchableOpacity>
      ) : null}
    </AuthLayout>
  );
}

/**
 * Stands in front of the app until the account has a Zaad account on file,
 * as ConsentGate does for the terms. If the profile can't be read (offline),
 * the app is let through rather than shut.
 */
export function ZaadGate({ children }: { children: React.ReactNode }) {
  const { profile, error } = useUserProfile();
  if (error) return <>{children}</>;
  if (!profile) return null;
  if (profile.zaad) return <>{children}</>;
  return <ZaadAccountForm gate phoneNumber={profile.phoneNumber} fullName={profile.fullName} />;
}

/** Profile → Zaad account. */
export default function ZaadAccountScreen({ navigation }: { navigation: any }) {
  const colors = useColors();
  const styles = useStyles();
  const { profile } = useUserProfile();
  if (!profile) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.ui.accentText} />
      </View>
    );
  }
  return (
    <ZaadAccountForm
      current={profile.zaad}
      phoneNumber={profile.phoneNumber}
      fullName={profile.fullName}
      onBack={() => navigation.goBack()}
      onSaved={() => navigation.goBack()}
    />
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: colors.ui.canvas,
  },
  backButton: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.lg,
    zIndex: 10,
    padding: spacing.sm,
  },
  backIcon: {
    fontSize: 32,
    color: colors.ui.text,
    lineHeight: 34,
  },
  hint: {
    ...typography.caption,
    color: colors.ui.textFaint,
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
  },
  button: {
    marginTop: spacing.sm,
  },
  signOut: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  signOutText: {
    ...typography.bodySemibold,
    color: colors.ui.textDim,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ui.canvas,
  },
}));
