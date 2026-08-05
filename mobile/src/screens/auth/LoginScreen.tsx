import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Linking,
  FlatList,
} from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { sendOTP } from '../../services/auth.service';
import { AuthLayout } from '../../components/auth';
import { BottomSheet } from '../../components/BottomSheet';
import { CheckIcon, ChevronDownIcon, CloseIcon } from '../../components/icons/AuthIcons';
import { colors, typography, spacing } from '../../theme';

interface Props {
  navigation: any;
  /**
   * Which button on the welcome screen got the user here. Sign-up and log-in
   * are the same phone + OTP flow underneath — new vs returning is resolved
   * after auth by the PIN gates — so this only changes the framing.
   */
  intent?: 'signup' | 'login';
  /** Returns to the welcome screen so a mis-tap isn't a dead end. */
  onBack?: () => void;
}

interface Country {
  code: string;
  flag: string;
  nameKey: string;
  placeholder: string;
  localLength: number;
  maxInput: number;
}

const COUNTRIES: Country[] = [
  {
    code: '+252',
    flag: '\u{1F1F8}\u{1F1F4}',
    nameKey: 'common.somalia',
    placeholder: 'XX XXX XXXX',
    localLength: 9,
    maxInput: 14,
  },
  {
    code: '+44',
    flag: '\u{1F1EC}\u{1F1E7}',
    nameKey: 'common.unitedKingdom',
    placeholder: 'XXXX XXX XXX',
    localLength: 10,
    maxInput: 15,
  },
];

const TERMS_URL = 'https://quickpay.app/terms';
const PRIVACY_URL = 'https://quickpay.app/privacy';

const CORAL = colors.dark.accent;

function BoltMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Polygon
        points="57,8 26,54 45,54 43,92 74,44 55,44"
        fill={CORAL}
        stroke={CORAL}
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function LoginScreen({ navigation, intent = 'signup', onBack }: Props) {
  const { t } = useTranslation();
  const returning = intent === 'login';
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [localNumber, setLocalNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [focused, setFocused] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const inputRef = useRef<TextInput>(null);

  const glow = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const ignite = useRef(new Animated.Value(0)).current;

  const cleanNumber = localNumber.replace(/[\s\-()]/g, '');

  const isValid = (() => {
    if (selectedCountry.code === '+252') {
      return /^\d{9}$/.test(cleanNumber);
    }
    if (selectedCountry.code === '+44') {
      return /^\d{10,11}$/.test(cleanNumber);
    }
    return false;
  })();

  useEffect(() => {
    Animated.spring(rise, { toValue: 1, tension: 60, friction: 12, useNativeDriver: true }).start();
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    breathe.start();
    return () => breathe.stop();
  }, [glow, rise]);

  // Continue button ignites from dimmed coral to full coral when valid
  useEffect(() => {
    Animated.spring(ignite, {
      toValue: isValid ? 1 : 0,
      tension: 120,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [isValid, ignite]);

  const handlePhoneChange = (text: string) => {
    const filtered = text.replace(/[^\d\s\-()]/g, '');
    setLocalNumber(filtered);
    if (phoneError) setPhoneError('');
    if (submitError) setSubmitError('');
  };

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setLocalNumber('');
    setPhoneError('');
    setShowCountryPicker(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleContinue = async () => {
    if (!isValid) {
      setPhoneError(t('auth.login.phoneInvalid'));
      return;
    }

    let normalizedNumber = cleanNumber;
    if (selectedCountry.code === '+44' && normalizedNumber.startsWith('0')) {
      normalizedNumber = normalizedNumber.substring(1);
    }

    const fullNumber = `${selectedCountry.code}${normalizedNumber}`;

    try {
      setLoading(true);
      setSubmitError('');
      const confirmation = await sendOTP(fullNumber);
      navigation.navigate('OTP', { phoneNumber: fullNumber, confirmation });
    } catch (error: any) {
      setSubmitError(error.message ?? t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const riseStyle = {
    opacity: rise,
    transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }],
  };

  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 0.75] });

  return (
    <AuthLayout contentStyle={styles.content} onBack={onBack}>
      {/* Ambient aura */}
      <Animated.View pointerEvents="none" style={[styles.auraOuter, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
      <Animated.View pointerEvents="none" style={[styles.auraInner, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />

      {/* Wordmark + progress dots */}
      <View style={styles.topRow}>
        <View style={styles.wordmark}>
          <BoltMark size={20} />
          <Text style={styles.brand}>
            <Text style={styles.brandBold}>Zapp</Text>
            {' '}
            <Text style={styles.brandLight}>Pay</Text>
          </Text>
        </View>
        <View style={styles.progressDots}>
          <View style={[styles.pDot, styles.pDotActive]} />
          <View style={styles.pDot} />
          <View style={styles.pDot} />
        </View>
      </View>

      <Animated.View style={riseStyle}>
        <Text style={styles.headerTitle}>
          {returning ? t('auth.login.titleReturning') : t('auth.login.title')}
        </Text>
        <Text style={styles.headerSubtitle}>
          {returning ? t('auth.login.subtitleReturning') : t('auth.login.subtitle')}
        </Text>
      </Animated.View>

      <Animated.View style={[styles.inputRow, riseStyle]}>
        <TouchableOpacity
          style={styles.countryPill}
          onPress={() => setShowCountryPicker(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.flagText}>{selectedCountry.flag}</Text>
          <Text style={styles.countryCodeText}>{selectedCountry.code}</Text>
          <ChevronDownIcon color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>

        <View
          style={[
            styles.phoneBox,
            focused && styles.phoneBoxFocused,
            phoneError ? styles.phoneBoxError : undefined,
          ]}
        >
          <TextInput
            ref={inputRef}
            style={styles.phoneInput}
            placeholder={selectedCountry.placeholder}
            value={localNumber}
            onChangeText={handlePhoneChange}
            keyboardType="phone-pad"
            maxLength={selectedCountry.maxInput}
            autoFocus
            placeholderTextColor="rgba(255,255,255,0.25)"
            textContentType="telephoneNumber"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => {
              if (!loading) handleContinue();
            }}
          />
          {localNumber.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setLocalNumber('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={styles.clearIcon}>
                <CloseIcon size={12} color="rgba(255,255,255,0.7)" />
              </View>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
      {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}

      <Animated.View style={riseStyle}>
        <Animated.View
          style={{
            opacity: ignite.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ scale: ignite.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1.03, 1] }) }],
          }}
        >
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={handleContinue}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={styles.continueText}>
              {loading ? t('auth.otp.sending') : t('auth.login.continue')}
            </Text>
            {!loading && <Text style={styles.continueArrow}>→</Text>}
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.footer}>
          {t('auth.login.termsFooter')}{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
            {t('auth.login.termsOfService')}
          </Text>
          {' '}{t('common.and')}{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
            {t('auth.login.privacyPolicy')}
          </Text>
        </Text>
      </Animated.View>

      <BottomSheet visible={showCountryPicker} onClose={() => setShowCountryPicker(false)} height="40%">
        <Text style={styles.sheetTitle}>{t('auth.login.selectCountry')}</Text>
        <FlatList
          data={COUNTRIES}
          keyExtractor={(item) => item.code}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.countryRow, item.code === selectedCountry.code && styles.countryRowSelected]}
              onPress={() => handleCountrySelect(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.countryRowFlag}>{item.flag}</Text>
              <View style={styles.countryRowInfo}>
                <Text style={styles.countryRowName}>{t(item.nameKey)}</Text>
                <Text style={styles.countryRowCode}>{item.code}</Text>
              </View>
              {item.code === selectedCountry.code && <CheckIcon />}
            </TouchableOpacity>
          )}
        />
      </BottomSheet>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  content: {
    justifyContent: 'flex-start',
  },
  auraOuter: {
    position: 'absolute',
    top: -170,
    left: -60,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(255,80,67,0.05)',
  },
  auraInner: {
    position: 'absolute',
    top: -120,
    left: 0,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(255,80,67,0.07)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brand: { fontSize: 16, letterSpacing: -0.3 },
  brandBold: { fontWeight: '700', color: colors.dark.text },
  brandLight: { fontWeight: '400', color: CORAL },
  progressDots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  pDotActive: { width: 16, backgroundColor: CORAL },
  headerTitle: {
    fontSize: 33,
    fontWeight: '800',
    color: colors.dark.text,
    letterSpacing: -1.4,
    lineHeight: 38,
    marginBottom: 10,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.dark.textDim,
    lineHeight: 21,
    marginBottom: spacing.xl,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  countryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 58,
  },
  flagText: {
    fontSize: 20,
  },
  countryCodeText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.dark.text,
  },
  phoneBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    height: 58,
    paddingHorizontal: 4,
  },
  phoneBoxFocused: {
    borderColor: CORAL,
  },
  phoneBoxError: {
    borderColor: colors.dark.error,
  },
  phoneInput: {
    flex: 1,
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.dark.text,
    paddingHorizontal: 12,
  },
  clearButton: {
    paddingRight: spacing.sm,
  },
  clearIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    ...typography.caption,
    color: colors.dark.error,
    marginTop: spacing.sm,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: 28,
    backgroundColor: CORAL,
    marginTop: 18,
  },
  continueText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  continueArrow: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  footer: {
    fontSize: 11,
    color: colors.dark.textFaint,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 12,
  },
  link: {
    color: colors.dark.textFaint,
    textDecorationLine: 'underline',
  },
  sheetTitle: {
    ...typography.h3,
    color: colors.dark.text,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
  },
  countryRowSelected: {
    backgroundColor: colors.dark.accentSoft,
  },
  countryRowFlag: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  countryRowInfo: {
    flex: 1,
  },
  countryRowName: {
    ...typography.body,
    color: colors.dark.text,
    fontWeight: '600',
  },
  countryRowCode: {
    ...typography.caption,
    color: colors.dark.textDim,
  },
});
