import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Animated,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { functions } from '../../services/firebase.config';
import { SetupSuccessScreen } from '../../components/auth';
import { logger } from '../../utils/logger';

type Service = 'cash_in' | 'cash_out';

const HARGEISA_AREAS = [
  "Sha'ab",
  'Jigjiga Yar',
  '26 June',
  'Ahmed Dhagah',
  'Mohamoud Haybe',
  'Hodan',
  'Golaha',
  'New Hargeisa',
  'Beer Khalaf',
  'Other',
];

const HOUR_PRESETS = [
  '8:00 AM – 6:00 PM',
  '8:00 AM – 8:00 PM',
  '9:00 AM – 5:00 PM',
  '7:00 AM – 9:00 PM',
  '24 hours',
];

// Area and hours are stored as written above and shown to customers as-is, so
// only the two chips that are words rather than names or times are translated
// for display; the saved value stays the same in every language.
const DISPLAY_KEYS: Record<string, string> = {
  Other: 'agentProfile.areaOther',
  '24 hours': 'agentProfile.hoursAllDay',
};

interface Props {
  navigation: any;
  /** When true, renders as a standalone settings screen with back button */
  isSettings?: boolean;
}

export default function AgentProfileSetupScreen({ navigation, isSettings }: Props) {
  const { t } = useTranslation();
  const chipLabel = (value: string) => (DISPLAY_KEYS[value] ? t(DISPLAY_KEYS[value]) : value);
  const [businessName, setBusinessName] = useState('');
  const [area, setArea] = useState('');
  const [openHours, setOpenHours] = useState('');
  const [customHours, setCustomHours] = useState('');
  const [services, setServices] = useState<Set<Service>>(new Set(['cash_in', 'cash_out']));
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideIn = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(slideIn, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
    ]).start();
  }, []);

  const toggleService = (s: Service) => {
    setServices((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const resolvedHours = openHours === 'custom' ? customHours.trim() : openHours;

  const canSubmit =
    area.trim() &&
    resolvedHours.trim() &&
    services.size > 0 &&
    !loading;

  const handleSave = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      const fn = functions().httpsCallable('setupAgentProfile');
      await fn({
        area: area.trim(),
        openHours: resolvedHours,
        services: Array.from(services),
        ...(businessName.trim() ? { businessName: businessName.trim() } : {}),
      });
      if (isSettings) {
        Alert.alert(t('agentProfile.savedTitle'), t('agentProfile.savedMessage'));
        navigation.goBack();
      } else {
        setShowSuccess(true);
      }
    } catch (e: any) {
      logger.error('Save agent profile failed:', e);
      Alert.alert(t('common.error'), t('agentProfile.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (showSuccess) {
    return <SetupSuccessScreen variant="merchant" onContinue={() => setShowSuccess(false)} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>

        <Animated.View style={{ opacity: fadeIn, transform: [{ translateY: slideIn }] }}>
          <Text style={styles.title}>{t('agentProfile.title')}</Text>
          <Text style={styles.subtitle}>{t('agentProfile.subtitle')}</Text>
        </Animated.View>

        {/* Business name (optional) */}
        <Animated.View style={[styles.section, { opacity: fadeIn }]}>
          <Text style={styles.sectionLabel}>{t('agentProfile.businessNameLabel')}</Text>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              value={businessName}
              onChangeText={setBusinessName}
              placeholder={t('agentProfile.businessNamePlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.2)"
              autoCapitalize="words"
            />
          </View>
          <Text style={styles.inputHint}>{t('agentProfile.businessNameHint')}</Text>
        </Animated.View>

        {/* Area */}
        <Animated.View style={[styles.section, { opacity: fadeIn }]}>
          <Text style={styles.sectionLabel}>{t('agentProfile.areaLabel')}</Text>
          <View style={styles.chipGrid}>
            {HARGEISA_AREAS.map((a) => (
              <TouchableOpacity
                key={a}
                style={[styles.chip, area === a && styles.chipActive]}
                onPress={() => setArea(a)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, area === a && styles.chipTextActive]}>
                  {chipLabel(a)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        {/* Open hours */}
        <Animated.View style={[styles.section, { opacity: fadeIn }]}>
          <Text style={styles.sectionLabel}>{t('agentProfile.hoursLabel')}</Text>
          <View style={styles.chipGrid}>
            {HOUR_PRESETS.map((h) => (
              <TouchableOpacity
                key={h}
                style={[styles.chip, openHours === h && styles.chipActive]}
                onPress={() => setOpenHours(h)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, openHours === h && styles.chipTextActive]}>
                  {chipLabel(h)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.chip, openHours === 'custom' && styles.chipActive]}
              onPress={() => setOpenHours('custom')}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, openHours === 'custom' && styles.chipTextActive]}>
                {t('agentProfile.hoursCustom')}
              </Text>
            </TouchableOpacity>
          </View>
          {openHours === 'custom' && (
            <View style={[styles.inputBox, { marginTop: 10 }]}>
              <TextInput
                style={styles.input}
                value={customHours}
                onChangeText={setCustomHours}
                placeholder={t('agentProfile.customHoursPlaceholder')}
                placeholderTextColor="rgba(255,255,255,0.2)"
                autoFocus
              />
            </View>
          )}
        </Animated.View>

        {/* Services */}
        <Animated.View style={[styles.section, { opacity: fadeIn }]}>
          <Text style={styles.sectionLabel}>{t('agentProfile.servicesLabel')}</Text>
          <View style={styles.serviceCards}>
            {([
              { id: 'cash_in' as Service, emoji: '💵', title: t('agentProfile.cashInTitle'), desc: t('agentProfile.cashInDesc') },
              { id: 'cash_out' as Service, emoji: '🏧', title: t('agentProfile.cashOutTitle'), desc: t('agentProfile.cashOutDesc') },
            ] as const).map((svc) => {
              const active = services.has(svc.id);
              return (
                <TouchableOpacity
                  key={svc.id}
                  style={[styles.serviceCard, active && styles.serviceCardActive]}
                  onPress={() => toggleService(svc.id)}
                  activeOpacity={0.75}
                >
                  <View style={styles.serviceCardLeft}>
                    <Text style={styles.serviceEmoji}>{svc.emoji}</Text>
                    <View style={styles.serviceText}>
                      <Text style={[styles.serviceTitle, active && styles.serviceTitleActive]}>
                        {svc.title}
                      </Text>
                      <Text style={styles.serviceDesc}>{svc.desc}</Text>
                    </View>
                  </View>
                  <View style={[styles.checkbox, active && styles.checkboxActive]}>
                    {active && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>

        {/* CTA */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.ctaBtn, !canSubmit && styles.ctaBtnDisabled]}
            onPress={handleSave}
            disabled={!canSubmit}
            activeOpacity={0.86}
          >
            <Text style={[styles.ctaText, !canSubmit && styles.ctaTextDisabled]}>
              {loading
                ? t('agentProfile.saving')
                : isSettings
                  ? t('agentProfile.save')
                  : t('agentProfile.complete')}
            </Text>
          </TouchableOpacity>
          {!isSettings && (
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => setShowSuccess(true)}
            >
              <Text style={styles.skipText}>{t('agentProfile.skip')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const ACCENT = '#FF5043';
const ACCENT_SOFT = 'rgba(26,86,255,0.18)';
const ACCENT_BORDER = 'rgba(26,86,255,0.5)';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 48 },

  backBtn: { width: 40, height: 40, justifyContent: 'center', marginTop: 12, marginBottom: 20, marginLeft: -6 },
  backChevron: { fontSize: 38, color: '#FFFFFF', lineHeight: 42, fontWeight: '300' },

  title: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1.2, lineHeight: 40, marginBottom: 10 },
  subtitle: { fontSize: 15, color: 'rgba(255,255,255,0.4)', lineHeight: 22, marginBottom: 32 },

  section: { marginBottom: 28 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)',
    marginBottom: 12,
  },

  inputBox: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    height: 52,
    justifyContent: 'center',
  },
  input: { fontSize: 15, color: '#FFFFFF', padding: 0 },
  inputHint: { fontSize: 12, color: 'rgba(255,255,255,0.25)', marginTop: 7 },

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipActive: { backgroundColor: ACCENT_SOFT, borderColor: ACCENT_BORDER },
  chipText: { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.5)' },
  chipTextActive: { color: '#FF8A7A', fontWeight: '600' },

  serviceCards: { gap: 10 },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.09)',
    padding: 16,
    gap: 14,
  },
  serviceCardActive: { backgroundColor: ACCENT_SOFT, borderColor: ACCENT_BORDER },
  serviceCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  serviceEmoji: { fontSize: 26 },
  serviceText: { flex: 1 },
  serviceTitle: { fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.6)', marginBottom: 3 },
  serviceTitleActive: { color: '#FFFFFF' },
  serviceDesc: { fontSize: 12, color: 'rgba(255,255,255,0.3)', lineHeight: 18 },

  checkbox: {
    width: 24, height: 24, borderRadius: 7,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  checkboxActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  checkmark: { fontSize: 13, color: '#FFFFFF', fontWeight: '700' },

  footer: { gap: 12, marginTop: 12 },
  ctaBtn: {
    backgroundColor: '#FFFFFF', borderRadius: 9999,
    height: 58, justifyContent: 'center', alignItems: 'center',
  },
  ctaBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.12)' },
  ctaText: { fontSize: 17, fontWeight: '700', color: '#000000', letterSpacing: -0.3 },
  ctaTextDisabled: { color: 'rgba(255,255,255,0.25)' },
  skipBtn: { alignItems: 'center', paddingVertical: 12 },
  skipText: { fontSize: 15, color: 'rgba(255,255,255,0.3)', fontWeight: '500' },
});
