import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { CodeInput, isWeakPin } from '../../components/auth';
import { Input } from '../../components/Input';
import { signOut } from '../../services/auth.service';
import type { MerchantOnboardingParamList } from '../../navigation/MerchantOnboardingNavigator';

type Nav = StackNavigationProp<MerchantOnboardingParamList, 'MerchantBasics'>;
type R = RouteProp<MerchantOnboardingParamList, 'MerchantBasics'>;

export default function MerchantBasicsScreen({
  navigation,
  route,
}: {
  navigation: Nav;
  route: R;
}) {
  const { t } = useTranslation();
  const prefilled = route.params?.prefilledName ?? '';
  const [fullName, setFullName] = useState(prefilled);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [nameError, setNameError] = useState('');
  const [pinError, setPinError] = useState('');
  const [confirmPinError, setConfirmPinError] = useState('');

  // Entrance animations
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(20)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const formSlide = useRef(new Animated.Value(20)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(headerSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(formOpacity, { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.spring(formSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
      Animated.timing(btnOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleContinue = () => {
    const name = fullName.trim();
    let valid = true;

    if (name.length < 2) {
      setNameError(t('auth.onboarding.basics.nameRequiredMessage'));
      valid = false;
    } else {
      setNameError('');
    }

    if (pin.length !== 6 || isWeakPin(pin)) {
      setPinError(t('auth.onboarding.basics.pinRequiredMessage'));
      valid = false;
    } else {
      setPinError('');
    }

    if (confirmPin.length !== 6) {
      setConfirmPinError(t('auth.onboarding.basics.pinRequiredMessage'));
      valid = false;
    } else if (pin !== confirmPin) {
      setConfirmPinError(t('auth.onboarding.basics.pinMismatchMessage'));
      valid = false;
    } else {
      setConfirmPinError('');
    }

    if (!valid) return;
    navigation.navigate('MerchantRoleSelect', { fullName: name, pin });
  };

  const canSubmit = fullName.trim().length >= 2 && pin.length === 6 && confirmPin.length === 6;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Ambient glow */}
      <View style={styles.glowContainer} pointerEvents="none">
        <View style={styles.glowCore} />
        <View style={styles.glowOuter} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Step indicator */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={signOut}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.backChevron}>‹</Text>
            </TouchableOpacity>
            <View style={styles.stepTrack}>
              <View style={[styles.stepDot, styles.stepDotActive]} />
              <View style={styles.stepDot} />
            </View>
          </View>

          {/* Header */}
          <Animated.View
            style={[
              styles.header,
              { opacity: headerOpacity, transform: [{ translateY: headerSlide }] },
            ]}
          >
            <Text style={styles.title}>{t('auth.onboarding.basics.title')}</Text>
            <Text style={styles.subtitle}>{t('auth.onboarding.basics.subtitle')}</Text>
          </Animated.View>

          {/* Form */}
          <Animated.View
            style={[
              styles.form,
              { opacity: formOpacity, transform: [{ translateY: formSlide }] },
            ]}
          >
            <Input
              label={t('auth.onboarding.basics.nameLabel')}
              value={fullName}
              onChangeText={(text) => {
                setFullName(text);
                if (nameError) setNameError('');
              }}
              placeholder={t('auth.onboarding.basics.namePlaceholder')}
              autoCapitalize="words"
              error={nameError}
              containerStyle={styles.field}
            />

            <Text style={styles.pinLabel}>{t('auth.onboarding.basics.createPin')}</Text>
            <CodeInput
              value={pin}
              onChange={(value) => {
                setPin(value);
                if (pinError) setPinError('');
              }}
              secure
              error={pinError}
              autoFocus={false}
            />

            <Text style={[styles.pinLabel, styles.confirmLabel]}>
              {t('auth.onboarding.basics.confirmPin')}
            </Text>
            <CodeInput
              value={confirmPin}
              onChange={(value) => {
                setConfirmPin(value);
                if (confirmPinError) setConfirmPinError('');
              }}
              secure
              error={confirmPinError}
              autoFocus={false}
            />

            <Text style={styles.hint}>{t('auth.onboarding.basics.hint')}</Text>
          </Animated.View>

          <View style={styles.spacer} />

          {/* CTA */}
          <Animated.View style={{ opacity: btnOpacity }}>
            <TouchableOpacity
              style={[styles.ctaBtn, !canSubmit && styles.ctaBtnDisabled]}
              onPress={handleContinue}
              activeOpacity={0.86}
            >
              <Text style={[styles.ctaText, !canSubmit && styles.ctaTextDisabled]}>
                {t('auth.onboarding.basics.continue')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  flex: { flex: 1 },

  // Ambient glow
  glowContainer: {
    position: 'absolute',
    bottom: '15%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowCore: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#FF5043',
    opacity: 0.1,
  },
  glowOuter: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#FF5043',
    opacity: 0.04,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },

  // Top bar: back + step dots
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    marginLeft: -6,
  },
  backChevron: {
    fontSize: 38,
    color: '#FFFFFF',
    lineHeight: 42,
    fontWeight: '300',
  },
  stepTrack: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  stepDotActive: {
    backgroundColor: '#FF5043',
    width: 24,
    borderRadius: 4,
  },

  // Header
  header: {
    marginBottom: 28,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1.4,
    color: '#FFFFFF',
    lineHeight: 44,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    color: 'rgba(255,255,255,0.4)',
  },

  // Form
  form: {
    gap: 4,
  },
  field: {
    marginBottom: 20,
  },
  pinLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 10,
    letterSpacing: 0.1,
  },
  confirmLabel: {
    marginTop: 20,
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    marginTop: 16,
    textAlign: 'center',
    lineHeight: 18,
  },

  spacer: { flex: 1, minHeight: 24 },

  // CTA
  ctaBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    height: 58,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  ctaTextDisabled: {
    color: 'rgba(255,255,255,0.25)',
  },
});
