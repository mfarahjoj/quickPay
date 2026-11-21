import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton, PinInput } from '../../components';
import { useAuth } from '../../hooks/useAuth';
import {
  inviteStaff,
  removeStaff,
  STAFF_ROLES,
  staffErrorReason,
  refundsOn,
  updateStaff,
  watchShopStaff,
  type StaffGrant,
  type StaffRole,
} from '../../services/staff.service';
import { isWrongPin, pinActionErrorKey } from '../../utils/errors';
import { formatCents, sanitizeAmountInput, toCents } from '../../utils/money';
import { logger } from '../../utils/logger';
import { makeStyles, useColors } from '../../theme';

/** The server's refusals this screen explains; anything else is a general error. */
const REASON_KEYS: Record<string, string> = {
  staff_bad_phone: 'staff.error.badPhone',
  staff_no_account: 'staff.error.noAccount',
  staff_self: 'staff.error.self',
  staff_not_customer: 'staff.error.business',
  staff_exists: 'staff.error.exists',
  staff_limit: 'staff.error.limit',
  staff_not_found: 'staff.error.notFound',
  staff_bad_refund_caps: 'staff.error.refundCaps',
};

type Step =
  | { kind: 'list' }
  | { kind: 'form'; editing: StaffGrant | null }
  | { kind: 'pin'; editing: StaffGrant | null };

/**
 * Settings → Staff (STAFF_ACCESS.md). The shop adds people by their Zapp
 * number and picks what they may do. They work on their own accounts and
 * never get the shop's login or PIN. Removing someone takes effect at once.
 */
export default function StaffScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffGrant[] | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('waiter');
  const [showCustomers, setShowCustomers] = useState(false);
  // Manager refunds: off unless the shop sets both limits (in dollars).
  const [refunds, setRefunds] = useState(false);
  const [capText, setCapText] = useState('');
  const [dayText, setDayText] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    return watchShopStaff(user.uid, setStaff, (err) => {
      logger.error('Staff list failed:', err);
      setStaff([]);
    });
  }, [user?.uid]);

  const openForm = (editing: StaffGrant | null) => {
    setPhone('');
    setRole(editing?.role ?? 'waiter');
    setShowCustomers(editing?.showCustomers ?? false);
    const on = editing ? refundsOn(editing) : false;
    setRefunds(on);
    setCapText(on ? (editing!.refundCapCents / 100).toFixed(2) : '');
    setDayText(on ? (editing!.refundDayCapCents / 100).toFixed(2) : '');
    setError('');
    setStep({ kind: 'form', editing });
  };

  const submit = async (entered: string, editing: StaffGrant | null) => {
    setSending(true);
    try {
      const customers = role === 'manager' && showCustomers;
      const caps =
        role === 'manager' && refunds
          ? { refundCapCents: toCents(capText), refundDayCapCents: toCents(dayText) }
          : { refundCapCents: 0, refundDayCapCents: 0 };
      if (editing) await updateStaff(editing.staffUid, role, customers, entered, caps);
      else await inviteStaff(phone, role, customers, entered);
      setStep({ kind: 'list' });
    } catch (err) {
      const reason = staffErrorReason(err);
      if (isWrongPin(err)) {
        setError(t('errors.wrongPin'));
      } else {
        // Wrong number, already on the list and so on: back to the form to fix it.
        setError(reason && REASON_KEYS[reason] ? t(REASON_KEYS[reason]) : t(pinActionErrorKey(err)));
        setStep({ kind: 'form', editing });
      }
    } finally {
      setPin('');
      setSending(false);
    }
  };

  const remove = (g: StaffGrant) =>
    Alert.alert(t('staff.removeTitle', { name: g.staffName }), t('staff.removeMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('staff.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(g.staffUid);
            await removeStaff(g.staffUid);
          } catch (err) {
            logger.error('Remove staff failed:', err);
            Alert.alert(t('common.error'), t('staff.removeFailed'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  if (step.kind === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('staff.pinTitle')}</Text>
        <Text style={styles.sub}>{t('staff.pinSubtitle')}</Text>
        <PinInput
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (error) setError('');
          }}
          onComplete={(entered) => submit(entered, step.editing)}
          style={styles.pinInput}
          autoFocus
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {sending ? <ActivityIndicator color={colors.ui.text} style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton
            label={t('common.cancel')}
            variant="glass"
            disabled={sending}
            onPress={() => setStep({ kind: 'form', editing: step.editing })}
          />
        </View>
      </DarkScreen>
    );
  }

  if (step.kind === 'form') {
    const editing = step.editing;
    const cap = toCents(capText);
    const day = toCents(dayText);
    const capsOk = !(editing && role === 'manager' && refunds) || (cap > 0 && day >= cap);
    const canContinue = (editing ? true : phone.replace(/\D/g, '').length >= 9) && capsOk;
    return (
      <DarkScreen scroll contentStyle={styles.content}>
        <ScreenHeader
          title={editing ? t('staff.editTitle', { name: editing.staffName }) : t('staff.addTitle')}
          onBack={() => setStep({ kind: 'list' })}
        />
        {editing ? null : (
          <>
            <Text style={styles.label}>{t('staff.phoneLabel')}</Text>
            <TextInput
              value={phone}
              onChangeText={(v) => {
                setPhone(v);
                if (error) setError('');
              }}
              placeholder="063 123 4567"
              placeholderTextColor={colors.ui.textFaint}
              keyboardType="phone-pad"
              style={styles.input}
              accessibilityLabel={t('staff.phoneLabel')}
            />
            <Text style={styles.help}>{t('staff.phoneHelp')}</Text>
          </>
        )}

        <Text style={styles.label}>{t('staff.roleLabel')}</Text>
        {STAFF_ROLES.map((r) => {
          const on = role === r;
          return (
            <TouchableOpacity
              key={r}
              onPress={() => setRole(r)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              activeOpacity={0.8}
            >
              <GlassCard style={[styles.roleCard, on && styles.roleCardOn]}>
                <Text style={styles.roleName}>{t(`staff.role.${r}`)}</Text>
                <Text style={styles.roleHelp}>{t(`staff.roleHelp.${r}`)}</Text>
              </GlassCard>
            </TouchableOpacity>
          );
        })}

        {role === 'manager' ? (
          <View style={styles.toggleRow}>
            <View style={styles.flex}>
              <Text style={styles.toggleLabel}>{t('staff.showCustomers')}</Text>
              <Text style={styles.help}>{t('staff.showCustomersHelp')}</Text>
            </View>
            <Switch value={showCustomers} onValueChange={setShowCustomers} />
          </View>
        ) : null}

        {role === 'manager' && editing ? (
          <>
            <View style={styles.toggleRow}>
              <View style={styles.flex}>
                <Text style={styles.toggleLabel}>{t('staff.refunds')}</Text>
                <Text style={styles.help}>{t('staff.refundsHelp')}</Text>
              </View>
              <Switch value={refunds} onValueChange={setRefunds} />
            </View>
            {refunds ? (
              <>
                <Text style={styles.label}>{t('staff.refundCapLabel')}</Text>
                <TextInput
                  value={capText}
                  onChangeText={(v) => setCapText(sanitizeAmountInput(v))}
                  placeholder="20.00"
                  placeholderTextColor={colors.ui.textFaint}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  accessibilityLabel={t('staff.refundCapLabel')}
                />
                <Text style={styles.label}>{t('staff.refundDayCapLabel')}</Text>
                <TextInput
                  value={dayText}
                  onChangeText={(v) => setDayText(sanitizeAmountInput(v))}
                  placeholder="100.00"
                  placeholderTextColor={colors.ui.textFaint}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  accessibilityLabel={t('staff.refundDayCapLabel')}
                />
                <Text style={styles.help}>{t('staff.refundCapsHelp')}</Text>
                {!capsOk && cap > 0 && day > 0 ? <Text style={styles.formError}>{t('staff.error.refundCaps')}</Text> : null}
              </>
            ) : null}
          </>
        ) : role === 'manager' ? (
          <Text style={styles.help}>{t('staff.refundsAfterAccept')}</Text>
        ) : null}

        <Text style={styles.never}>{t('staff.neverGranted')}</Text>
        {error ? <Text style={styles.formError}>{error}</Text> : null}

        <View style={styles.buttons}>
          <PillButton
            label={t('common.continue')}
            disabled={!canContinue}
            onPress={() => {
              setError('');
              setStep({ kind: 'pin', editing });
            }}
          />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll contentStyle={styles.content}>
      <ScreenHeader title={t('staff.title')} onBack={() => navigation.goBack()} />
      <Text style={styles.intro}>{t('staff.intro')}</Text>

      {staff === null ? (
        <ActivityIndicator color={colors.ui.text} style={styles.spinner} />
      ) : staff.length === 0 ? (
        <Text style={styles.empty}>{t('staff.none')}</Text>
      ) : (
        staff.map((g) => (
          <GlassCard key={g.grantId} style={styles.card}>
            <Text style={styles.name}>{g.staffName}</Text>
            <Text style={styles.meta}>
              {g.staffPhone} · {t(`staff.role.${g.role}`)}
              {g.status === 'invited' ? ` · ${t('staff.invitedTag')}` : ''}
            </Text>
            {g.role === 'manager' && g.showCustomers ? (
              <Text style={styles.meta}>{t('staff.seesCustomers')}</Text>
            ) : null}
            {refundsOn(g) ? (
              <Text style={styles.meta}>
                {t('staff.refundsUpTo', { each: formatCents(g.refundCapCents), day: formatCents(g.refundDayCapCents) })}
              </Text>
            ) : null}
            {busy === g.staffUid ? (
              <ActivityIndicator color={colors.ui.text} style={styles.rowSpinner} />
            ) : (
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => openForm(g)}>
                  <Text style={styles.action}>{t('staff.change')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => remove(g)}>
                  <Text style={styles.danger}>{t('staff.remove')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </GlassCard>
        ))
      )}

      <View style={styles.buttons}>
        <PillButton label={t('staff.add')} onPress={() => openForm(null)} />
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  bigTitle: { fontSize: 24, fontWeight: '800', color: colors.ui.text, textAlign: 'center' },
  sub: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center', marginTop: 8, lineHeight: 21 },
  pinInput: { marginTop: 32 },
  error: { fontSize: 14, color: colors.ui.error, marginTop: 16, textAlign: 'center' },
  formError: { fontSize: 14, color: colors.ui.error, marginHorizontal: 24, marginTop: 12 },
  spinner: { marginTop: 24 },
  block: { alignSelf: 'stretch', marginTop: 32 },
  intro: { fontSize: 15, color: colors.ui.textDim, lineHeight: 21, marginHorizontal: 24, marginBottom: 20 },
  empty: { fontSize: 15, color: colors.ui.textFaint, marginHorizontal: 24, lineHeight: 21 },
  card: { marginHorizontal: 20, marginBottom: 12, padding: 16 },
  name: { fontSize: 16, fontWeight: '700', color: colors.ui.text },
  meta: { fontSize: 13, color: colors.ui.textFaint, marginTop: 6 },
  rowSpinner: { marginTop: 12, alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', marginTop: 12, gap: 24 },
  action: { fontSize: 15, fontWeight: '600', color: colors.ui.accent },
  danger: { fontSize: 15, fontWeight: '600', color: colors.ui.error },
  buttons: { marginHorizontal: 20, marginTop: 20 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ui.textFaint,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 10,
  },
  input: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.ui.divider,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: colors.ui.text,
  },
  help: { fontSize: 13, color: colors.ui.textFaint, lineHeight: 18, marginHorizontal: 24, marginTop: 6 },
  roleCard: { marginHorizontal: 20, marginBottom: 10, padding: 16, borderWidth: 1, borderColor: 'transparent' },
  roleCardOn: { borderColor: colors.ui.accent },
  roleName: { fontSize: 16, fontWeight: '700', color: colors.ui.text },
  roleHelp: { fontSize: 14, color: colors.ui.textDim, lineHeight: 20, marginTop: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 0, marginTop: 8, paddingRight: 24 },
  flex: { flex: 1 },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: colors.ui.text, marginHorizontal: 24 },
  never: { fontSize: 13, color: colors.ui.textFaint, lineHeight: 18, marginHorizontal: 24, marginTop: 16 },
}));
