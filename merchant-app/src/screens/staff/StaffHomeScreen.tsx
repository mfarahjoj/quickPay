import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, GlassCard, PillButton } from '../../components';
import { useAuth } from '../../hooks/useAuth';
import {
  leaveShop,
  respondToInvite,
  roleCanCharge,
  roleCanRefund,
  roleCanUsePortal,
  setActingFor,
  watchMyGrants,
  type StaffGrant,
} from '../../services/staff.service';
import { confirmSignOut } from '../../utils/confirmSignOut';
import { logger } from '../../utils/logger';
import { makeStyles, useColors } from '../../theme';

/**
 * Staff mode home (STAFF_ACCESS.md). A person a shop added as staff works for
 * it here on their own account: invitations to accept, the shop they're
 * working for, and only what their role allows. The shop's balance, payouts
 * and settings are never here; refunds only for a manager the shop allows.
 */
export default function StaffHomeScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [grants, setGrants] = useState<StaffGrant[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    return watchMyGrants(user.uid, setGrants, (err) => {
      logger.error('Staff grants failed:', err);
      setGrants([]);
    });
  }, [user?.uid]);

  const invites = useMemo(() => (grants ?? []).filter((g) => g.status === 'invited'), [grants]);
  const active = useMemo(() => (grants ?? []).filter((g) => g.status === 'active'), [grants]);
  const current = active.find((g) => g.merchantUid === selected) ?? active[0] ?? null;

  // Every shop call from here names the shop it's for. Removed or left: nothing.
  useEffect(() => {
    setActingFor(current?.merchantUid ?? null);
  }, [current?.merchantUid]);
  useEffect(() => () => setActingFor(null), []);

  const respond = async (g: StaffGrant, accept: boolean) => {
    try {
      setBusy(g.grantId);
      await respondToInvite(g.merchantUid, accept);
      if (accept) setSelected(g.merchantUid);
    } catch (err) {
      logger.error('Respond to staff invite failed:', err);
      Alert.alert(t('common.error'), t('staff.respondFailed'));
    } finally {
      setBusy(null);
    }
  };

  const leave = (g: StaffGrant) =>
    Alert.alert(t('staff.leaveTitle', { shop: g.shopName }), t('staff.leaveMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('staff.leave'),
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(g.grantId);
            await leaveShop(g.merchantUid);
          } catch (err) {
            logger.error('Leave shop failed:', err);
            Alert.alert(t('common.error'), t('staff.leaveFailed'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  if (grants === null) {
    return (
      <DarkScreen contentStyle={styles.centered}>
        <ActivityIndicator color={colors.ui.text} />
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll contentStyle={styles.content}>
      <Text style={styles.title}>{t('staff.home.title')}</Text>
      <Text style={styles.intro}>{t(active.length > 0 ? 'staff.home.intro' : 'staff.home.introInvited')}</Text>

      {invites.map((g) => (
        <GlassCard key={g.grantId} style={styles.card}>
          <Text style={styles.cardTitle}>{t('staff.invite.title', { shop: g.shopName })}</Text>
          <Text style={styles.meta}>
            {t('staff.invite.as', { role: t(`staff.role.${g.role}`) })}
          </Text>
          <Text style={styles.body}>{t(`staff.staffHelp.${g.role}`)}</Text>
          {busy === g.grantId ? (
            <ActivityIndicator color={colors.ui.text} style={styles.rowSpinner} />
          ) : (
            <View style={styles.row}>
              <View style={styles.flex}>
                <PillButton label={t('staff.invite.accept')} onPress={() => respond(g, true)} />
              </View>
              <View style={styles.gapX} />
              <View style={styles.flex}>
                <PillButton label={t('staff.invite.decline')} variant="glass" onPress={() => respond(g, false)} />
              </View>
            </View>
          )}
        </GlassCard>
      ))}

      {current ? (
        <>
          {active.length > 1 ? (
            <>
              <Text style={styles.sectionLabel}>{t('staff.home.pickShop')}</Text>
              <View style={styles.chips}>
                {active.map((g) => {
                  const on = g.merchantUid === current.merchantUid;
                  return (
                    <TouchableOpacity
                      key={g.grantId}
                      onPress={() => setSelected(g.merchantUid)}
                      style={[styles.chip, on && styles.chipOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{g.shopName}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}

          <GlassCard style={styles.card}>
            <Text style={styles.hint}>{t('staff.home.workingFor')}</Text>
            <Text style={styles.shop}>{current.shopName}</Text>
            <Text style={styles.meta}>{t(`staff.role.${current.role}`)}</Text>
            <Text style={styles.body}>{t(`staff.staffHelp.${current.role}`)}</Text>
          </GlassCard>

          <View style={styles.buttons}>
            {roleCanCharge(current.role) ? (
              <PillButton label={t('staff.home.charge')} onPress={() => navigation.navigate('ScanCharge')} />
            ) : null}
            {roleCanUsePortal(current.role) ? (
              <>
                <View style={styles.gap} />
                <PillButton
                  label={t('staff.home.portal')}
                  variant="glass"
                  onPress={() => navigation.navigate('PortalSignIn')}
                />
              </>
            ) : null}
            {roleCanRefund(current.role) ? (
              <>
                <View style={styles.gap} />
                <PillButton
                  label={t('staff.home.refunds')}
                  variant="glass"
                  onPress={() => navigation.navigate('StaffPayments')}
                />
              </>
            ) : null}
            {current.role === 'waiter' ? <Text style={styles.body}>{t('staff.home.waiterSoon')}</Text> : null}
          </View>

          <TouchableOpacity
            onPress={() => leave(current)}
            disabled={busy === current.grantId}
            style={styles.linkWrap}
          >
            <Text style={styles.danger}>{t('staff.leaveShop', { shop: current.shopName })}</Text>
          </TouchableOpacity>
        </>
      ) : invites.length === 0 ? (
        <Text style={styles.body}>{t('staff.home.none')}</Text>
      ) : null}

      <TouchableOpacity onPress={() => confirmSignOut(t)} style={styles.linkWrap}>
        <Text style={styles.link}>{t('staff.signOut')}</Text>
      </TouchableOpacity>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { paddingTop: 24, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '800', color: colors.ui.text, marginHorizontal: 24, marginBottom: 8 },
  intro: { fontSize: 15, color: colors.ui.textDim, lineHeight: 21, marginHorizontal: 24, marginBottom: 20 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ui.textFaint,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: 24,
    marginBottom: 10,
  },
  card: { marginHorizontal: 20, marginBottom: 14, padding: 18 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.ui.text },
  hint: { fontSize: 13, color: colors.ui.textFaint },
  shop: { fontSize: 22, fontWeight: '800', color: colors.ui.text, marginTop: 4 },
  meta: { fontSize: 14, fontWeight: '600', color: colors.ui.accent, marginTop: 6 },
  body: { fontSize: 14, color: colors.ui.textDim, lineHeight: 20, marginTop: 10 },
  row: { flexDirection: 'row', marginTop: 16 },
  flex: { flex: 1 },
  gapX: { width: 12 },
  gap: { height: 12 },
  rowSpinner: { marginTop: 16, alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 20, marginBottom: 14 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.ui.divider,
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: { backgroundColor: colors.ui.accent, borderColor: colors.ui.accent },
  chipText: { fontSize: 14, color: colors.ui.text },
  chipTextOn: { color: '#FFFFFF', fontWeight: '700' },
  buttons: { marginHorizontal: 20, marginTop: 6 },
  linkWrap: { marginHorizontal: 24, marginTop: 24, alignSelf: 'flex-start' },
  link: { fontSize: 15, fontWeight: '600', color: colors.ui.textDim },
  danger: { fontSize: 15, fontWeight: '600', color: colors.ui.error },
}));
