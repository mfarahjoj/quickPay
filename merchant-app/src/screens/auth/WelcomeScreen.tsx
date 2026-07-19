import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  StatusBar,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, LanguageOption } from '../../i18n/languages';
import { applyLanguage } from '../../i18n';
import type { PreferredLanguage } from '../../types';

interface Props {
  navigation: any;
}

function LanguagePicker() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;

  const openMenu = () => {
    setOpen(true);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
  };

  const closeMenu = () => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setOpen(false);
      scaleAnim.setValue(0.92);
    });
  };

  const handleSelect = async (lang: LanguageOption) => {
    closeMenu();
    await applyLanguage(lang.code as PreferredLanguage);
  };

  return (
    <>
      <TouchableOpacity style={styles.langBtn} onPress={openMenu} activeOpacity={0.75}>
        <Text style={styles.langFlag}>{currentLang.flag}</Text>
        <Text style={styles.langCode}>{currentLang.code.toUpperCase()}</Text>
        <Text style={styles.langChevron}>›</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="none" onRequestClose={closeMenu}>
        <Pressable style={styles.modalBackdrop} onPress={closeMenu}>
          <Animated.View
            style={[
              styles.dropdown,
              { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
            ]}
          >
            {SUPPORTED_LANGUAGES.map((lang, index) => {
              const isSelected = lang.code === i18n.language;
              const isLast = index === SUPPORTED_LANGUAGES.length - 1;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[styles.langOption, !isLast && styles.langOptionBorder]}
                  onPress={() => handleSelect(lang)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.optionFlag}>{lang.flag}</Text>
                  <View style={styles.optionText}>
                    <Text style={[styles.optionName, isSelected && styles.optionNameSelected]}>
                      {lang.nativeName}
                    </Text>
                    <Text style={styles.optionLabel}>{lang.label}</Text>
                  </View>
                  {isSelected && <Text style={styles.optionCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

export default function WelcomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textSlide = useRef(new Animated.Value(20)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;
  const btnSlide = useRef(new Animated.Value(16)).current;
  const glowScale = useRef(new Animated.Value(0.6)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(glowOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(glowScale, { toValue: 1, tension: 40, friction: 12, useNativeDriver: true }),
    ]).start();

    Animated.sequence([
      Animated.delay(100),
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(350),
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(textSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(600),
      Animated.parallel([
        Animated.timing(btnOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(btnSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <Animated.View
        style={[styles.glowContainer, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
        pointerEvents="none"
      >
        <View style={styles.glowCore} />
        <View style={styles.glowOuter} />
      </Animated.View>

      {/* Top bar: brand row left, language picker right */}
      <View style={styles.topBar}>
        <Animated.View
          style={[styles.brandRow, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}
        >
          <View style={styles.iconMark}>
            <Text style={styles.iconLetter}>Q</Text>
          </View>
          <View style={styles.brandText}>
            <Text style={styles.wordmark}>Zapp Pay</Text>
            <Text style={styles.tagline}>{t('auth.welcome.tagline')}</Text>
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: logoOpacity }}>
          <LanguagePicker />
        </Animated.View>
      </View>

      {/* Hero copy */}
      <Animated.View
        style={[styles.heroBlock, { opacity: textOpacity, transform: [{ translateY: textSlide }] }]}
      >
        <Text style={styles.heroTitle}>{t('auth.welcome.heroTitle')}</Text>
        <Text style={styles.heroSub}>{t('auth.welcome.heroSub')}</Text>
      </Animated.View>

      {/* Pinned CTA */}
      <Animated.View
        style={[styles.bottom, { opacity: btnOpacity, transform: [{ translateY: btnSlide }] }]}
      >
        <TouchableOpacity
          style={styles.getStartedBtn}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.86}
        >
          <Text style={styles.getStartedText}>{t('auth.welcome.getStarted')}</Text>
        </TouchableOpacity>
        <Text style={styles.signInHint}>
          {t('auth.welcome.alreadyHaveAccount')}{' '}
          <Text style={styles.signInLink} onPress={() => navigation.navigate('Login')}>
            {t('auth.welcome.signIn')}
          </Text>
        </Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },

  // Glow
  glowContainer: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowCore: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#FF5043',
    opacity: 0.18,
  },
  glowOuter: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#FF5043',
    opacity: 0.06,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconMark: {
    width: 52,
    height: 52,
    borderRadius: 15,
    backgroundColor: '#FF5043',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconLetter: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  brandText: {
    gap: 1,
  },
  wordmark: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: '#FFFFFF',
  },
  tagline: {
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.4)',
  },

  // Language picker trigger
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingVertical: 7,
    paddingLeft: 10,
    paddingRight: 8,
    gap: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  langFlag: {
    fontSize: 16,
  },
  langCode: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  langChevron: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.5)',
    marginTop: -1,
  },

  // Dropdown modal
  modalBackdrop: {
    flex: 1,
  },
  dropdown: {
    position: 'absolute',
    top: 80,
    right: 24,
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    overflow: 'hidden',
    minWidth: 200,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  langOptionBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  optionFlag: {
    fontSize: 24,
  },
  optionText: {
    flex: 1,
    gap: 1,
  },
  optionName: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.65)',
  },
  optionNameSelected: {
    color: '#FFFFFF',
  },
  optionLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
  },
  optionCheck: {
    fontSize: 15,
    color: '#FF5043',
    fontWeight: '700',
  },

  // Hero
  heroBlock: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    gap: 16,
  },
  heroTitle: {
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -2,
    color: '#FFFFFF',
    lineHeight: 56,
  },
  heroSub: {
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 26,
    color: 'rgba(255,255,255,0.45)',
  },

  // Bottom CTA
  bottom: {
    paddingHorizontal: 28,
    paddingBottom: 12,
    gap: 14,
  },
  getStartedBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    height: 58,
    justifyContent: 'center',
    alignItems: 'center',
  },
  getStartedText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  signInHint: {
    textAlign: 'center',
    fontSize: 14,
    color: 'rgba(255,255,255,0.35)',
    paddingBottom: 4,
  },
  signInLink: {
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },
});
