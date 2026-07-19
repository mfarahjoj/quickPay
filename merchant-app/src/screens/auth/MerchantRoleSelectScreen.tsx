import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { SetupSuccessScreen, useToast } from '../../components/auth';
import { Input } from '../../components/Input';
import { HandshakeIcon, StoreIcon } from '../../components/icons/AuthIcons';
import { completeMerchantSetup, signOut } from '../../services/auth.service';
import type { MerchantOnboardingParamList } from '../../navigation/MerchantOnboardingNavigator';

type Nav = StackNavigationProp<MerchantOnboardingParamList, 'MerchantRoleSelect'>;
type R = RouteProp<MerchantOnboardingParamList, 'MerchantRoleSelect'>;

type RoleId = 'topup_agent' | 'merchant';

const ROLES: { id: RoleId; titleKey: string; shortKey: string; tagKey: string; accessKey: string; emoji: string }[] = [
  {
    id: 'topup_agent',
    titleKey: 'auth.onboarding.role.partner.title',
    shortKey: 'auth.onboarding.role.partner.short',
    tagKey: 'auth.onboarding.role.partner.tag',
    accessKey: 'auth.onboarding.role.partner.accessibilityLabel',
    emoji: '🤝',
  },
  {
    id: 'merchant',
    titleKey: 'auth.onboarding.role.retail.title',
    shortKey: 'auth.onboarding.role.retail.short',
    tagKey: 'auth.onboarding.role.retail.tag',
    accessKey: 'auth.onboarding.role.retail.accessibilityLabel',
    emoji: '🏪',
  },
];

function resolveAccountType(selected: Set<RoleId>): 'merchant' | 'topup_agent' | 'agent_merchant' {
  if (selected.has('merchant') && selected.has('topup_agent')) return 'agent_merchant';
  if (selected.has('merchant')) return 'merchant';
  return 'topup_agent';
}

export default function MerchantRoleSelectScreen({
  navigation,
  route,
}: {
  navigation: Nav;
  route: R;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const initialName = route.params.fullName ?? '';
  const pinFromRoute = route.params.pin;

  const [fullName, setFullName] = useState(initialName);
  const [selected, setSelected] = useState<Set<RoleId>>(new Set());
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [nameError, setNameError] = useState('');
  const [roleError, setRoleError] = useState('');

  const bothSelected = selected.has('topup_agent') && selected.has('merchant');

  // Entrance animations
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(20)).current;
  const card0Opacity = useRef(new Animated.Value(0)).current;
  const card0Slide = useRef(new Animated.Value(24)).current;
  const card1Opacity = useRef(new Animated.Value(0)).current;
  const card1Slide = useRef(new Animated.Value(24)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;
  const bothBadgeScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(headerSlide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(card0Opacity, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.spring(card0Slide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(card1Opacity, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.spring(card1Slide, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
      ]),
      Animated.timing(btnOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  }, []);

  // Animate "Full service" badge when both selected
  useEffect(() => {
    Animated.spring(bothBadgeScale, {
      toValue: bothSelected ? 1 : 0,
      tension: 80,
      friction: 9,
      useNativeDriver: true,
    }).start();
  }, [bothSelected]);

  const cardAnims = [
    { opacity: card0Opacity, slide: card0Slide },
    { opacity: card1Opacity, slide: card1Slide },
  ];

  const toggleRole = (id: RoleId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (roleError) setRoleError('');
  };

  const handleFinish = async () => {
    const name = fullName.trim();
    let valid = true;

    if (name.length < 2) {
      setNameError(t('auth.onboarding.role.nameRequiredMessage'));
      valid = false;
    } else {
      setNameError('');
    }

    if (selected.size === 0) {
      setRoleError(t('auth.onboarding.role.chooseTypeMessage'));
      valid = false;
    } else {
      setRoleError('');
    }

    if (!valid) return;

    try {
      setLoading(true);
      const accountType = resolveAccountType(selected);
      await completeMerchantSetup({
        fullName: name,
        accountType,
        ...(pinFromRoute ? { pin: pinFromRoute } : {}),
      });
      if (accountType === 'topup_agent' || accountType === 'agent_merchant') {
        navigation.navigate('AgentProfileSetup');
      } else {
        setShowSuccess(true);
      }
    } catch (e: any) {
      showToast(e.message || t('auth.onboarding.role.couldNotFinishMessage'), 'error');
    } finally {
      setLoading(false);
    }
  };

  if (showSuccess) {
    return <SetupSuccessScreen variant="merchant" onContinue={() => setShowSuccess(false)} />;
  }

  const canSubmit = selected.size > 0 && fullName.trim().length >= 2;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <View style={styles.glowContainer} pointerEvents="none">
        <View style={styles.glowCore} />
        <View style={styles.glowOuter} />
      </View>

      <View style={styles.content}>
        {/* Back */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={pinFromRoute ? () => navigation.goBack() : signOut}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>

        {/* Header */}
        <Animated.View
          style={[styles.header, { opacity: headerOpacity, transform: [{ translateY: headerSlide }] }]}
        >
          <Text style={styles.title}>{t('auth.onboarding.role.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.onboarding.role.subtitle')}</Text>
        </Animated.View>

        {/* Name */}
        {!pinFromRoute ? (
          <Animated.View style={{ opacity: headerOpacity }}>
            <Input
              label={t('auth.onboarding.role.nameLabel')}
              value={fullName}
              onChangeText={(text) => { setFullName(text); if (nameError) setNameError(''); }}
              placeholder={t('auth.onboarding.role.namePlaceholder')}
              autoCapitalize="words"
              error={nameError}
              containerStyle={styles.nameInput}
            />
          </Animated.View>
        ) : (
          <Animated.View style={[styles.namePill, { opacity: headerOpacity }]}>
            <Text style={styles.namePillLabel}>{t('auth.onboarding.role.registeringAs')}</Text>
            <Text style={styles.namePillValue}>{fullName.trim()}</Text>
          </Animated.View>
        )}

        {/* Section label — explicitly tells users both is an option */}
        <Animated.View style={[styles.selectLabelRow, { opacity: card0Opacity }]}>
          <Text style={styles.selectLabel}>Pick one</Text>
          <View style={styles.selectLabelDot} />
          <Text style={styles.selectLabelBoth}>or select both</Text>
        </Animated.View>

        {/* Role cards */}
        <View style={styles.cards}>
          {ROLES.map((role, index) => {
            const isSelected = selected.has(role.id);
            const anim = cardAnims[index];
            return (
              <Animated.View
                key={role.id}
                style={{ opacity: anim.opacity, transform: [{ translateY: anim.slide }] }}
              >
                <TouchableOpacity
                  style={[styles.card, isSelected && styles.cardSelected]}
                  onPress={() => { toggleRole(role.id); if (roleError) setRoleError(''); }}
                  activeOpacity={0.78}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={t(role.accessKey)}
                >
                  <View style={[styles.iconWrap, isSelected && styles.iconWrapSelected]}>
                    <Text style={styles.iconEmoji}>{role.emoji}</Text>
                  </View>
                  <View style={styles.cardText}>
                    <View style={styles.cardTitleRow}>
                      <Text style={[styles.cardTitle, isSelected && styles.cardTitleSelected]}>
                        {t(role.titleKey)}
                      </Text>
                      <Text style={[styles.cardTag, isSelected && styles.cardTagSelected]}>
                        {t(role.tagKey)}
                      </Text>
                    </View>
                    <Text style={styles.cardDesc}>{t(role.shortKey)}</Text>
                  </View>
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })}

          {/* "Select both" shortcut — visible but unobtrusive */}
          <Animated.View style={[styles.bothRow, { opacity: card1Opacity }]}>
            {bothSelected ? (
              <Animated.View
                style={[styles.bothBadge, { transform: [{ scale: bothBadgeScale }], opacity: bothBadgeScale }]}
              >
                <Text style={styles.bothBadgeEmoji}>⚡</Text>
                <Text style={styles.bothBadgeText}>{t('auth.onboarding.role.bothBadge')}</Text>
                <TouchableOpacity
                  onPress={() => setSelected(new Set())}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.bothClear}>✕</Text>
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <TouchableOpacity
                style={styles.selectBothPill}
                onPress={() => {
                  setSelected(new Set(['topup_agent', 'merchant']));
                  if (roleError) setRoleError('');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.selectBothText}>I do both  ⚡</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </View>

        {roleError ? <Text style={styles.roleError}>{roleError}</Text> : null}

        <View style={styles.spacer} />

        {/* CTA */}
        <Animated.View style={{ opacity: btnOpacity }}>
          <TouchableOpacity
            style={[styles.ctaBtn, (!canSubmit || loading) && styles.ctaBtnDisabled]}
            onPress={handleFinish}
            activeOpacity={0.86}
            disabled={!canSubmit || loading}
          >
            <Text style={[styles.ctaText, (!canSubmit || loading) && styles.ctaTextDisabled]}>
              {loading ? 'Setting up…' : t('auth.onboarding.role.completeRegistration')}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

  glowContainer: {
    position: 'absolute',
    bottom: '20%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowCore: { width: 200, height: 200, borderRadius: 100, backgroundColor: '#FF5043', opacity: 0.1 },
  glowOuter: { position: 'absolute', width: 340, height: 340, borderRadius: 170, backgroundColor: '#FF5043', opacity: 0.04 },

  content: { flex: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },

  backBtn: { width: 40, height: 40, justifyContent: 'center', marginBottom: 20, marginLeft: -6 },
  backChevron: { fontSize: 38, color: '#FFFFFF', lineHeight: 42, fontWeight: '300' },

  header: { marginBottom: 24 },
  title: { fontSize: 36, fontWeight: '800', letterSpacing: -1.4, color: '#FFFFFF', lineHeight: 44, marginBottom: 10 },
  subtitle: { fontSize: 15, fontWeight: '400', lineHeight: 22, color: 'rgba(255,255,255,0.4)' },

  nameInput: { marginBottom: 20 },
  namePill: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  namePillLabel: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 3, letterSpacing: 0.3, textTransform: 'uppercase' },
  namePillValue: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },

  // Section label
  selectLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  selectLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.1,
  },
  selectLabelDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  selectLabelBoth: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5B8AFF',
  },

  cards: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.09)',
    padding: 16,
    gap: 14,
  },
  cardSelected: { backgroundColor: 'rgba(26,86,255,0.18)', borderColor: '#FF5043' },
  iconWrap: { width: 50, height: 50, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  iconWrapSelected: { backgroundColor: 'rgba(26,86,255,0.3)' },
  iconEmoji: { fontSize: 24 },
  cardText: { flex: 1, gap: 4 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontSize: 17, fontWeight: '700', color: 'rgba(255,255,255,0.65)', letterSpacing: -0.3 },
  cardTitleSelected: { color: '#FFFFFF' },
  cardTag: {
    fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, overflow: 'hidden',
  },
  cardTagSelected: { color: '#FF5043', backgroundColor: 'rgba(26,86,255,0.2)' },
  cardDesc: { fontSize: 13, color: 'rgba(255,255,255,0.35)', lineHeight: 19 },

  // Checkbox
  checkbox: {
    width: 24, height: 24, borderRadius: 7,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  checkboxSelected: { backgroundColor: '#FF5043', borderColor: '#FF5043' },
  checkmark: { fontSize: 13, color: '#FFFFFF', fontWeight: '700' },

  // "Select both" / badge row
  bothRow: { alignItems: 'center', marginTop: 6 },
  selectBothPill: {
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(91,138,255,0.35)',
    backgroundColor: 'rgba(26,86,255,0.1)',
  },
  selectBothText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5B8AFF',
    letterSpacing: -0.2,
  },
  bothBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26,86,255,0.18)',
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(26,86,255,0.4)',
    paddingVertical: 9,
    paddingHorizontal: 16,
    gap: 8,
  },
  bothBadgeEmoji: { fontSize: 15 },
  bothBadgeText: { fontSize: 14, fontWeight: '700', color: '#5B8AFF' },
  bothClear: { fontSize: 13, color: 'rgba(255,255,255,0.35)', fontWeight: '600' },

  roleError: { fontSize: 13, color: '#FF453A', textAlign: 'center', marginTop: 8 },
  spacer: { flex: 1, minHeight: 20 },

  ctaBtn: { backgroundColor: '#FFFFFF', borderRadius: 9999, height: 58, justifyContent: 'center', alignItems: 'center' },
  ctaBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.12)' },
  ctaText: { fontSize: 17, fontWeight: '700', color: '#000000', letterSpacing: -0.3 },
  ctaTextDisabled: { color: 'rgba(255,255,255,0.25)' },
});
