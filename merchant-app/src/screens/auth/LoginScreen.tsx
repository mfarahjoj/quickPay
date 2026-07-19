import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Linking,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  StatusBar,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { sendOTP } from '../../services/auth.service';
import { BottomSheet } from '../../components/BottomSheet';
import { CheckIcon } from '../../components/icons/AuthIcons';
import { colors } from '../../theme';

interface Props {
  navigation: any;
}

interface Country {
  code: string;
  flag: string;
  nameKey: string;
  placeholderKey: string;
  maxInput: number;
}

const COUNTRIES: Country[] = [
  {
    code: '+252',
    flag: '\u{1F1F8}\u{1F1F4}',
    nameKey: 'common.country.somalia',
    placeholderKey: 'common.phonePlaceholder.somalia',
    maxInput: 14,
  },
  {
    code: '+44',
    flag: '\u{1F1EC}\u{1F1E7}',
    nameKey: 'common.country.unitedKingdom',
    placeholderKey: 'common.phonePlaceholder.unitedKingdom',
    maxInput: 15,
  },
];

const TERMS_URL = 'https://quickpay.app/terms';
const PRIVACY_URL = 'https://quickpay.app/privacy';

export default function LoginScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [localNumber, setLocalNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [focused, setFocused] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  // Entrance animations
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleSlide = useRef(new Animated.Value(20)).current;
  const inputOpacity = useRef(new Animated.Value(0)).current;
  const inputSlide = useRef(new Animated.Value(20)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;

  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(titleSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(inputOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(inputSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
      Animated.timing(btnOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      inputRef.current?.focus();
    });
  }, []);

  const cleanNumber = localNumber.replace(/[\s\-\(\)]/g, '');

  const isValid = (() => {
    if (selectedCountry.code === '+252') return /^\d{9}$/.test(cleanNumber);
    if (selectedCountry.code === '+44') return /^\d{10,11}$/.test(cleanNumber);
    return false;
  })();

  const handlePhoneChange = (text: string) => {
    setLocalNumber(text.replace(/[^\d\s\-\(\)]/g, ''));
    if (phoneError) setPhoneError('');
  };

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setLocalNumber('');
    setPhoneError('');
    setShowCountryPicker(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSendOTP = async () => {
    if (!isValid) {
      setPhoneError(t('auth.login.invalidPhoneMessage', { country: t(selectedCountry.nameKey) }));
      return;
    }
    let normalizedNumber = cleanNumber;
    if (selectedCountry.code === '+44' && normalizedNumber.startsWith('0')) {
      normalizedNumber = normalizedNumber.substring(1);
    }
    const fullNumber = `${selectedCountry.code}${normalizedNumber}`;
    try {
      setLoading(true);
      const confirmation = await sendOTP(fullNumber);
      navigation.navigate('OTP', { phoneNumber: fullNumber, confirmation });
    } catch (error: any) {
      setPhoneError(error.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Subtle glow — same as welcome screen for continuity */}
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
          {/* Back button */}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.backChevron}>‹</Text>
          </TouchableOpacity>

          {/* Headline */}
          <Animated.View
            style={{ opacity: titleOpacity, transform: [{ translateY: titleSlide }] }}
          >
            <Text style={styles.title}>What's your{'\n'}number?</Text>
            <Text style={styles.subtitle}>
              We'll send you a one-time code{'\n'}to verify your identity.
            </Text>
          </Animated.View>

          {/* Phone input */}
          <Animated.View
            style={[
              styles.inputSection,
              { opacity: inputOpacity, transform: [{ translateY: inputSlide }] },
            ]}
          >
            <View
              style={[
                styles.inputRow,
                focused && styles.inputRowFocused,
                phoneError ? styles.inputRowError : undefined,
              ]}
            >
              <TouchableOpacity
                style={styles.countryBtn}
                onPress={() => setShowCountryPicker(true)}
                activeOpacity={0.65}
              >
                <Text style={styles.flagText}>{selectedCountry.flag}</Text>
                <Text style={styles.countryCode}>{selectedCountry.code}</Text>
                <Text style={styles.dropChevron}>›</Text>
              </TouchableOpacity>
              <View style={styles.divider} />
              <TextInput
                ref={inputRef}
                style={styles.phoneInput}
                placeholder={t(selectedCountry.placeholderKey)}
                value={localNumber}
                onChangeText={handlePhoneChange}
                keyboardType="phone-pad"
                maxLength={selectedCountry.maxInput}
                placeholderTextColor="rgba(255,255,255,0.2)"
                textContentType="telephoneNumber"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onSubmitEditing={() => { if (!loading) handleSendOTP(); }}
              />
              {localNumber.length > 0 && (
                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={() => { setLocalNumber(''); setPhoneError(''); }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.clearX}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            {phoneError ? (
              <Text style={styles.errorText}>{phoneError}</Text>
            ) : null}
          </Animated.View>

          <View style={styles.spacer} />

          {/* CTA */}
          <Animated.View style={{ opacity: btnOpacity }}>
            <TouchableOpacity
              style={[styles.ctaBtn, (!isValid || loading) && styles.ctaBtnDisabled]}
              onPress={handleSendOTP}
              activeOpacity={0.86}
              disabled={!isValid || loading}
            >
              <Text style={[styles.ctaText, (!isValid || loading) && styles.ctaTextDisabled]}>
                {loading ? 'Sending…' : 'Continue'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.legal}>
              {t('auth.login.footerPrefix')}{' '}
              <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
                {t('auth.login.termsOfService')}
              </Text>
              {' '}{t('auth.login.and')}{' '}
              <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
                {t('auth.login.privacyPolicy')}
              </Text>
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Country picker */}
      <BottomSheet
        visible={showCountryPicker}
        onClose={() => setShowCountryPicker(false)}
        height="40%"
      >
        <Text style={styles.sheetTitle}>Select country</Text>
        <FlatList
          data={COUNTRIES}
          keyExtractor={(item) => item.code}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.countryRow,
                item.code === selectedCountry.code && styles.countryRowSelected,
              ]}
              onPress={() => handleCountrySelect(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.countryRowFlag}>{item.flag}</Text>
              <View style={styles.countryRowInfo}>
                <Text style={styles.countryRowName}>{t(item.nameKey)}</Text>
                <Text style={styles.countryRowCode}>{item.code}</Text>
              </View>
              {item.code === selectedCountry.code && <CheckIcon color={colors.primary} />}
            </TouchableOpacity>
          )}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  flex: { flex: 1 },

  // Ambient glow (same position as welcome for visual continuity)
  glowContainer: {
    position: 'absolute',
    bottom: '25%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowCore: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#FF5043',
    opacity: 0.12,
  },
  glowOuter: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: '#FF5043',
    opacity: 0.05,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 16,
  },

  // Back
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    marginBottom: 28,
    marginLeft: -6,
  },
  backChevron: {
    fontSize: 38,
    color: '#FFFFFF',
    lineHeight: 42,
    fontWeight: '300',
  },

  // Headline
  title: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1.8,
    color: '#FFFFFF',
    lineHeight: 50,
    marginBottom: 14,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 40,
  },

  // Input section
  inputSection: {
    gap: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    height: 64,
  },
  inputRowFocused: {
    backgroundColor: 'rgba(255,255,255,0.11)',
    borderColor: '#FF5043',
  },
  inputRowError: {
    borderColor: '#FF453A',
    backgroundColor: 'rgba(255,69,58,0.08)',
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 12,
    gap: 7,
  },
  flagText: {
    fontSize: 22,
  },
  countryCode: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  dropChevron: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.35)',
    marginTop: -1,
    transform: [{ rotate: '90deg' }],
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  phoneInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '500',
    color: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 0,
    height: '100%',
  },
  clearBtn: {
    paddingRight: 18,
  },
  clearX: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
  },
  errorText: {
    fontSize: 13,
    color: '#FF453A',
    paddingLeft: 4,
  },

  spacer: { flex: 1, minHeight: 40 },

  // CTA — white pill like welcome screen
  ctaBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    height: 58,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  ctaBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  ctaTextDisabled: {
    color: 'rgba(255,255,255,0.3)',
  },

  // Legal
  legal: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
    lineHeight: 18,
    paddingBottom: 4,
  },
  legalLink: {
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '600',
  },

  // Country picker sheet
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 16,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 12,
  },
  countryRowSelected: {
    backgroundColor: '#F0F4FF',
  },
  countryRowFlag: {
    fontSize: 28,
  },
  countryRowInfo: {
    flex: 1,
  },
  countryRowName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  countryRowCode: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
});
