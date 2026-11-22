import React, { useEffect, useRef, useState } from 'react';
import { TERMS_URL, PRIVACY_URL } from '../../utils/legal';
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
import Svg, { Polygon, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { sendOTP } from '../../services/auth.service';
import { AuthLayout } from '../../components/auth';
import { BottomSheet } from '../../components/BottomSheet';
import { LanguageSelector } from '../../components/LanguageSelector';
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
  /** Unique id; two countries can share a dialling code. */
  id: string;
  code: string;
  /** Emoji flag; null draws the Somaliland flag, which has no emoji. */
  flag: string | null;
  nameKey: string;
  /** Digit groups as typed, e.g. [2, 3, 4] → "63 123 4567". */
  groups: number[];
  /** Accepted local lengths. A leading trunk 0 (UK, Sweden) is allowed and dropped. */
  digits: number[];
  trunkZero?: boolean;
  example: string;
}

// Somali numbers only for now. Add a row here to open sign-up to another
// country; the picker appears on its own once there is more than one.
const COUNTRIES: Country[] = [
  { id: 'SL', code: '+252', flag: null, nameKey: 'auth.login.countrySomaliland', groups: [2, 3, 4], digits: [9], example: '63 123 4567' },
];
const CAN_PICK_COUNTRY = COUNTRIES.length > 1;

const placeholderFor = (c: Country) => c.example.replace(/\d/g, 'X');
const maxDigits = (c: Country) => Math.max(...c.digits) + (c.trunkZero ? 1 : 0);

/** Groups digits as the person types: "631234567" → "63 123 4567". */
function formatLocal(digits: string, c: Country): string {
  const body = c.trunkZero && digits.startsWith('0') ? digits.slice(1) : digits;
  const lead = body === digits ? '' : '0';
  const parts: string[] = [];
  let i = 0;
  c.groups.forEach((g, idx) => {
    if (i >= body.length) return;
    const last = idx === c.groups.length - 1;
    parts.push(body.slice(i, last ? undefined : i + g));
    i += g;
  });
  return lead + parts.join(' ');
}

/** Somaliland flag: green, white with a black star, red. */
function SomalilandFlag({ width = 24 }: { width?: number }) {
  const h = (width * 2) / 3;
  return (
    <Svg width={width} height={h} viewBox="0 0 30 20">
      <Rect x="0" y="0" width="30" height="6.67" fill="#006D21" />
      <Rect x="0" y="6.67" width="30" height="6.67" fill="#FFFFFF" />
      <Rect x="0" y="13.33" width="30" height="6.67" fill="#D21034" />
      <Polygon
        points="15,7.4 15.7,9.4 17.8,9.4 16.1,10.6 16.7,12.6 15,11.4 13.3,12.6 13.9,10.6 12.2,9.4 14.3,9.4"
        fill="#000000"
      />
    </Svg>
  );
}

function CountryFlag({ country, size }: { country: Country; size: number }) {
  if (country.flag) return <Text style={{ fontSize: size }}>{country.flag}</Text>;
  return <SomalilandFlag width={size * 1.3} />;
}


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

  const insets = useSafeAreaInsets();
  const cleanNumber = localNumber.replace(/\D/g, '');
  const nationalNumber =
    selectedCountry.trunkZero && cleanNumber.startsWith('0') ? cleanNumber.slice(1) : cleanNumber;
  const isValid = selectedCountry.digits.includes(nationalNumber.length);

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
    // Pasted or autofilled numbers may carry the country code; drop it.
    let digits = text.replace(/\D/g, '');
    const cc = selectedCountry.code.slice(1);
    if (text.trim().startsWith('+') && digits.startsWith(cc)) digits = digits.slice(cc.length);
    setLocalNumber(formatLocal(digits.slice(0, maxDigits(selectedCountry)), selectedCountry));
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
      setPhoneError(
        t('auth.login.phoneInvalidHint', {
          digits: selectedCountry.digits[0],
          example: selectedCountry.example,
        }),
      );
      return;
    }

    const fullNumber = `${selectedCountry.code}${nationalNumber}`;

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
    <AuthLayout
      contentStyle={styles.content}
      onBack={onBack}
      topRight={<LanguageSelector dark />}
      backdrop={
        // Ambient aura, drawn behind the status bar so it isn't cut off.
        <>
          <Animated.View pointerEvents="none" style={[styles.auraOuter, { top: insets.top - 170, opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
          <Animated.View pointerEvents="none" style={[styles.auraInner, { top: insets.top - 120, opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
        </>
      }
    >

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
          disabled={!CAN_PICK_COUNTRY}
          activeOpacity={0.7}
        >
          <CountryFlag country={selectedCountry} size={20} />
          <Text style={styles.countryCodeText}>{selectedCountry.code}</Text>
          {CAN_PICK_COUNTRY && <ChevronDownIcon color="rgba(255,255,255,0.4)" />}
        </TouchableOpacity>

        <View
          style={[
            styles.phoneBox,
            focused && styles.phoneBoxFocused,
            isValid && styles.phoneBoxValid,
            phoneError ? styles.phoneBoxError : undefined,
          ]}
        >
          <TextInput
            ref={inputRef}
            style={styles.phoneInput}
            placeholder={placeholderFor(selectedCountry)}
            value={localNumber}
            onChangeText={handlePhoneChange}
            keyboardType="phone-pad"
            maxLength={maxDigits(selectedCountry) + selectedCountry.groups.length + 2}
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

      <BottomSheet visible={showCountryPicker} onClose={() => setShowCountryPicker(false)} height="65%">
        <Text style={styles.sheetTitle}>{t('auth.login.selectCountry')}</Text>
        <FlatList
          data={COUNTRIES}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.countryRow, item.id === selectedCountry.id && styles.countryRowSelected]}
              onPress={() => handleCountrySelect(item)}
              activeOpacity={0.7}
            >
              <View style={styles.countryRowFlagBox}><CountryFlag country={item} size={24} /></View>
              <View style={styles.countryRowInfo}>
                <Text style={styles.countryRowName}>{t(item.nameKey)}</Text>
                <Text style={styles.countryRowCode}>{item.code}</Text>
              </View>
              {item.id === selectedCountry.id && <CheckIcon />}
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
    left: -60,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(255,80,67,0.05)',
  },
  auraInner: {
    position: 'absolute',
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
  // Focus is a neutral highlight; coral is kept for a complete number so an
  // empty field never looks like an error.
  phoneBoxFocused: {
    borderColor: 'rgba(255,255,255,0.35)',
  },
  phoneBoxValid: {
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
  countryRowFlagBox: {
    width: 36,
    alignItems: 'center',
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
