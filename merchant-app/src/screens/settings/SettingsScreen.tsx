import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Linking, I18nManager } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { signOut } from '../../services/auth.service';
import { useMerchantProfile } from '../../hooks/useMerchantProfile';
import { useAuth } from '../../hooks/useAuth';
import { useCounterDisplayOn } from '../../hooks/useCounterDisplayOn';
import { needsReply, useMyDisputes } from '../../services/dispute.service';
import { formatLocal } from '../../utils/zaad';
import { LanguageSelector, DarkScreen, ScreenHeader, GlassCard } from '../../components';
import { ChartIcon, DisplayIcon, PeopleIcon } from '../../components/icons/AuthIcons';
import { makeStyles, useColors, useTheme, type AppearancePreference } from '../../theme';
import type { Tint } from '../../theme/colors';

const APPEARANCE_OPTIONS: { value: AppearancePreference; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.appearanceAuto' },
  { value: 'light', labelKey: 'settings.appearanceLight' },
  { value: 'dark', labelKey: 'settings.appearanceDark' },
];

function roleLabel(type: string | undefined, t: (k: string) => string) {
  if (type === 'agent_merchant') return t('dashboard.role.both');
  if (type === 'topup_agent') return t('dashboard.role.agent');
  return t('dashboard.role.merchant');
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.rowValueMono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function TappableRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowDetail}>{value}</Text> : null}
      <Text style={styles.rowChevron}>›</Text>
    </TouchableOpacity>
  );
}

interface Tool {
  key: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  tint: Tint;
  title: string;
  hint: string;
  route: string;
}

/** A shop feature: tinted icon, name, and one line on what it does. */
function ToolRow({ tool, onPress }: { tool: Tool; onPress: () => void }) {
  const styles = useStyles();
  const { Icon, tint } = tool;
  return (
    <TouchableOpacity
      style={styles.toolRow}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${tool.title}. ${tool.hint}`}
    >
      <View style={[styles.toolIcon, { backgroundColor: tint.fill }]}>
        <Icon size={20} color={tint.mark} />
      </View>
      <View style={styles.toolText}>
        <Text style={styles.toolTitle}>{tool.title}</Text>
        <Text style={styles.toolHint} numberOfLines={2}>
          {tool.hint}
        </Text>
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { preference, setPreference } = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile } = useMerchantProfile();
  const navigation = useNavigation<StackNavigationProp<any>>();
  const { disputes } = useMyDisputes();
  const counterDisplay = useCounterDisplayOn();
  const repliesDue = disputes.filter((d) => needsReply(d, user?.uid)).length;

  const isAgent =
    profile?.accountType === 'topup_agent' || profile?.accountType === 'agent_merchant';
  // API keys are for accounts that take payments (isMerchantAccount on the server).
  const takesPayments =
    profile?.accountType === 'merchant' || profile?.accountType === 'agent_merchant';

  // The shop's features, in one place. All of them are for accounts that take payments.
  const tools: Tool[] = takesPayments
    ? [
        // A tablet on the counter that shows the shop's QR and each sale.
        ...(counterDisplay.on
          ? [{
              key: 'counterDisplay',
              Icon: DisplayIcon,
              tint: colors.tints.blue,
              title: t('counterDisplay.title'),
              hint: t('settings.tools.counterDisplayHint'),
              route: 'CounterDisplays',
            }]
          : []),
        // The shop's live figures and insights on a computer (read-only).
        {
          key: 'zappBusiness',
          Icon: ChartIcon,
          tint: colors.tints.green,
          title: t('portal.title'),
          hint: t('settings.tools.zappBusinessHint'),
          route: 'ZappBusiness',
        },
        // People who work for the shop on their own accounts (STAFF_ACCESS.md).
        {
          key: 'staff',
          Icon: PeopleIcon,
          tint: colors.tints.amber,
          title: t('staff.title'),
          hint: t('settings.tools.staffHint'),
          route: 'Staff',
        },
        // API keys stay in Developers near the bottom, not here: most shops
        // never need one, and a prominent row invites "Zapp support" scams.
      ]
    : [];

  const handleLogout = () => {
    Alert.alert(t('settings.signOutConfirmTitle'), t('settings.signOutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.signOut'), style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const businessName = profile?.businessName || t('settings.merchantAccountFallback');
  const initial = (businessName || 'Q').charAt(0).toUpperCase();

  return (
    <DarkScreen scroll contentStyle={styles.content}>
      <ScreenHeader
        title={t('navigation.tabs.settings')}
        right={<LanguageSelector currentLanguage={profile?.preferredLanguage} compact />}
      />

      {/* Profile card */}
      <GlassCard style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
        <Text style={styles.merchantName}>{businessName}</Text>
        <Text style={styles.phone}>{user?.phoneNumber ?? '—'}</Text>
        <View style={styles.roleTag}>
          <Text style={styles.roleTagText}>{roleLabel(profile?.accountType, t)}</Text>
        </View>
      </GlassCard>

      {/* Shop tools */}
      {tools.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t('settings.section.shopTools')}</Text>
          <GlassCard style={styles.sectionCard}>
            {tools.map((tool, i) => (
              <React.Fragment key={tool.key}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <ToolRow tool={tool} onPress={() => navigation.navigate(tool.route)} />
              </React.Fragment>
            ))}
          </GlassCard>
        </>
      )}

      {/* Account */}
      <Text style={styles.sectionLabel}>{t('settings.section.account')}</Text>
      <GlassCard style={styles.sectionCard}>
        <Row label={t('settings.phone')} value={user?.phoneNumber ?? '—'} />
        <View style={styles.divider} />
        <Row label={t('settings.uid')} value={user?.uid ?? '—'} mono />
        {profile?.email ? (
          <>
            <View style={styles.divider} />
            <Row label={t('settings.email')} value={profile.email} />
          </>
        ) : null}
        <View style={styles.divider} />
        {/* Where payouts go. */}
        <TappableRow
          label={t('settings.zaadAccount')}
          value={profile?.zaad ? formatLocal(profile.zaad.msisdn) : undefined}
          onPress={() => navigation.navigate('ZaadAccount')}
        />
      </GlassCard>

      {/* Security */}
      <Text style={styles.sectionLabel}>{t('settings.section.security')}</Text>
      <GlassCard style={[styles.sectionCard, { paddingHorizontal: 16 }]}>
        <TappableRow label={t('security.title')} onPress={() => navigation.navigate('Security')} />
      </GlassCard>

      {/* Appearance: the phone's setting, or always light or dark. */}
      <Text style={styles.sectionLabel}>{t('settings.section.appearance')}</Text>
      <GlassCard style={styles.sectionCard}>
        <View style={styles.segmented}>
          {APPEARANCE_OPTIONS.map(({ value, labelKey }) => {
            const selected = preference === value;
            return (
              <TouchableOpacity
                key={value}
                style={[styles.segment, selected && styles.segmentSelected]}
                onPress={() => setPreference(value)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                  {t(labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </GlassCard>

      {/* Agent profile */}
      {isAgent && (
        <>
          <Text style={styles.sectionLabel}>{t('settings.section.agent')}</Text>
          <GlassCard style={[styles.sectionCard, { paddingHorizontal: 16 }]}>
            <TappableRow
              label={t('settings.updateAgentProfile')}
              onPress={() => navigation.navigate('AgentProfileEdit')}
            />
          </GlassCard>
        </>
      )}

      {/* Disputes */}
      <Text style={styles.sectionLabel}>{t('settings.section.disputes')}</Text>
      <GlassCard style={[styles.sectionCard, { paddingHorizontal: 16 }]}>
        <TappableRow
          label={
            repliesDue > 0
              ? t('settings.disputesWithCount', { count: repliesDue })
              : t('settings.disputes')
          }
          onPress={() => navigation.navigate('DisputesInbox')}
        />
      </GlassCard>

      {/* Developers */}
      {takesPayments && (
        <>
          <Text style={styles.sectionLabel}>{t('settings.section.developers')}</Text>
          <GlassCard style={[styles.sectionCard, { paddingHorizontal: 16 }]}>
            <TappableRow
              label={t('settings.apiKeys')}
              onPress={() => navigation.navigate('Developers')}
            />
          </GlassCard>
        </>
      )}

      {/* Help */}
      <Text style={styles.sectionLabel}>{t('settings.section.help')}</Text>
      <GlassCard style={[styles.sectionCard, { paddingHorizontal: 16 }]}>
        <TappableRow
          label={t('settings.supportPage')}
          onPress={() => Linking.openURL('https://zapppay.web.app/support').catch(() => {})}
        />
        <TappableRow
          label={t('settings.emailSupport')}
          onPress={() => Linking.openURL('mailto:support@zapppay.so').catch(() => {})}
        />
      </GlassCard>

      {/* App */}
      <Text style={styles.sectionLabel}>{t('settings.section.app')}</Text>
      <GlassCard style={styles.sectionCard}>
        <Row label={t('settings.version')} value="1.0.0" />
      </GlassCard>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>{t('settings.signOut')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={() => navigation.navigate('DeleteAccount')}
        activeOpacity={0.7}
      >
        <Text style={styles.deleteText}>{t('settings.deleteAccount')}</Text>
      </TouchableOpacity>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: {
    paddingBottom: 48,
  },

  profileCard: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 28,
    padding: 24,
    alignItems: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.ui.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarInitial: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  merchantName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ui.text,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  phone: {
    fontSize: 15,
    color: colors.ui.textFaint,
    marginBottom: 12,
  },
  roleTag: {
    backgroundColor: colors.ui.accentSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.ui.accentBorder,
  },
  roleTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ui.accentText,
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    // Spacing breaks Arabic's joined letters.
    letterSpacing: I18nManager.isRTL ? 0 : 0.6,
    textTransform: 'uppercase',
    color: colors.ui.ink(0.35),
    // Both sides: in Arabic the margin flips to the right while the text
    // stays on the left, which put the label against the screen's edge.
    marginHorizontal: 28,
    marginBottom: 10,
  },
  sectionCard: {
    marginHorizontal: 20,
    marginBottom: 28,
    paddingHorizontal: 16,
  },
  segmented: {
    flexDirection: 'row',
    marginVertical: 12,
    padding: 4,
    borderRadius: 12,
    backgroundColor: colors.ui.glassRaised,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 9,
  },
  segmentSelected: {
    backgroundColor: colors.ui.accent,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ui.textDim,
  },
  segmentTextSelected: {
    color: '#FFFFFF',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    gap: 16,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.ui.ink(0.55),
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ui.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  rowValueMono: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.ui.textFaint,
    maxWidth: 180,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.ui.divider,
  },

  logoutBtn: {
    marginHorizontal: 20,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.ui.errorSoft,
    borderWidth: 1,
    borderColor: colors.ui.errorSoft,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ui.error,
  },
  deleteBtn: {
    alignSelf: 'center',
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  deleteText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ui.errorSoft,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
  },
  toolIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolText: {
    flex: 1,
  },
  toolTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ui.text,
    marginBottom: 2,
  },
  toolHint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.ui.textFaint,
  },
  rowDetail: {
    flex: 1,
    textAlign: 'right',
    fontSize: 15,
    color: colors.ui.ink(0.85),
  },
  rowChevron: {
    fontSize: 20,
    color: colors.ui.ink(0.25),
    fontWeight: '300',
  },
}));
