import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard, PillButton, PinInput } from '../../components';
import { SuccessCheckIcon } from '../../components/icons/AuthIcons';
import {
  ApiKeyMode,
  ApiKeyRow,
  LIVE_PURPOSE_MAX,
  LIVE_PURPOSE_MIN,
  LiveAccess,
  MAX_ACTIVE_KEYS_PER_MODE,
  apiBaseUrl,
  createMyApiKey,
  isLiveAccessRequired,
  listMyApiKeys,
  requestLiveApiAccess,
  revokeMyApiKey,
} from '../../services/apiKeys.service';
import { useExitGuard } from '../../hooks/useExitGuard';
import { callableErrorKey, isWrongPin, pinActionErrorKey } from '../../utils/errors';
import { makeStyles, useColors } from '../../theme';

type Step = 'list' | 'label' | 'pin' | 'created';

const MODES: ApiKeyMode[] = ['test', 'live'];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Developers: the merchant's own Merchant API keys.
 *
 * Replaces asking Zapp ops for a key. Test keys are free to make and never
 * move money, so a developer can start building at once. Live keys need Zapp's
 * approval of the shop's live access first (asked for here, decided in the
 * console), then the PIN for each. A new key is shown once, here, and never again — the server keeps only
 * its hash — so leaving that step asks first.
 */
export default function DevelopersScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const [mode, setMode] = useState<ApiKeyMode>('test');
  const [step, setStep] = useState<Step>('list');
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [label, setLabel] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [created, setCreated] = useState<(ApiKeyRow & { apiKey: string }) | null>(null);
  const [liveAccess, setLiveAccess] = useState<LiveAccess | null>(null);
  const [purpose, setPurpose] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const mine = await listMyApiKeys();
      setKeys(mine.keys);
      setLiveAccess(mine.liveAccess);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = useMemo(
    () => (keys ?? []).filter((k) => k.mode === mode && !k.revoked),
    [keys, mode],
  );
  const atLimit = active.length >= MAX_ACTIVE_KEYS_PER_MODE;
  // Live keys wait for Zapp's approval; test keys never do.
  const needsAccess = mode === 'live' && liveAccess !== null && liveAccess.status !== 'approved';

  const askForAccess = async () => {
    if (requesting) return;
    setRequesting(true);
    setAccessError(null);
    try {
      setLiveAccess(await requestLiveApiAccess(purpose.trim()));
      setPurpose('');
    } catch (e: any) {
      setAccessError(t(callableErrorKey(e)));
    } finally {
      setRequesting(false);
    }
  };

  const backToList = () => {
    setPin('');
    setPinError(null);
    setStep('list');
  };

  useExitGuard(navigation, {
    blocked: submitting,
    onExit:
      step === 'label' || step === 'pin'
        ? backToList
        : step === 'created'
          ? (leave) =>
              Alert.alert(t('developers.leaveTitle'), t('developers.leaveMessage'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('developers.leaveConfirm'), style: 'destructive', onPress: leave },
              ])
          : undefined,
  });

  const create = async (enteredPin?: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createMyApiKey({
        label: label.trim(),
        mode,
        ...(enteredPin ? { pin: enteredPin } : {}),
      });
      setCreated(result);
      setKeys((prev) => [result, ...(prev ?? [])]);
      setLabel('');
      setStep('created');
    } catch (e: any) {
      if (isLiveAccessRequired(e)) {
        // Withdrawn (or never given) while the form was open: show where things stand.
        setStep('list');
        load();
      } else if (isWrongPin(e)) {
        setPinError(t('errors.wrongPin'));
      } else {
        setError(
          t(
            e?.code === 'functions/resource-exhausted' && /active/i.test(e?.message ?? '')
              ? 'developers.limitReached'
              : mode === 'live'
                ? pinActionErrorKey(e)
                : callableErrorKey(e),
            { count: MAX_ACTIVE_KEYS_PER_MODE },
          ),
        );
        setStep('label');
      }
    } finally {
      setPin('');
      setSubmitting(false);
    }
  };

  const confirmRevoke = (key: ApiKeyRow) => {
    Alert.alert(
      t('developers.revokeTitle'),
      t('developers.revokeMessage', { label: key.label }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('developers.revoke'),
          style: 'destructive',
          onPress: async () => {
            setRevoking(key.keyId);
            try {
              const row = await revokeMyApiKey(key.keyId);
              setKeys((prev) => (prev ?? []).map((k) => (k.keyId === row.keyId ? row : k)));
            } catch (e: any) {
              Alert.alert(t('common.error'), t(callableErrorKey(e)));
            } finally {
              setRevoking(null);
            }
          },
        },
      ],
    );
  };

  const shareKey = () => {
    if (!created) return;
    Share.share({
      message: t(`developers.shareMessage.${created.mode}`, {
        label: created.label,
        key: created.apiKey,
        baseUrl: apiBaseUrl(),
      }),
    }).catch(() => undefined);
  };

  if (step === 'pin') {
    return (
      <DarkScreen edges={[]} contentStyle={styles.centered}>
        <Text style={styles.bigTitle}>{t('developers.pinTitle')}</Text>
        <Text style={styles.sub}>{t('developers.pinSubtitle')}</Text>
        <PinInput
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (pinError) setPinError(null);
          }}
          onComplete={create}
          style={styles.pinInput}
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        {submitting ? <ActivityIndicator color={colors.ui.text} style={styles.spinner} /> : null}
        <View style={styles.block}>
          <PillButton label={t('common.cancel')} variant="glass" onPress={backToList} disabled={submitting} />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'created' && created) {
    return (
      <DarkScreen scroll contentStyle={styles.createdContent}>
        <View style={styles.createdHead}>
          <SuccessCheckIcon size={64} />
          <Text style={styles.bigTitle}>{t(`developers.createdTitle.${created.mode}`)}</Text>
          <Text style={styles.sub}>{created.label}</Text>
        </View>

        <GlassCard style={styles.secretCard}>
          <Text style={styles.secret} selectable>
            {created.apiKey}
          </Text>
        </GlassCard>
        <Text style={styles.warning}>{t('developers.createdWarning')}</Text>
        <Text style={styles.warning}>{t('developers.neverAsk')}</Text>

        <View style={styles.actions}>
          <PillButton label={t('developers.shareKey')} onPress={shareKey} />
          <PillButton
            label={t('common.done')}
            variant="glass"
            onPress={() => {
              setCreated(null);
              setStep('list');
            }}
          />
        </View>
      </DarkScreen>
    );
  }

  if (step === 'label') {
    return (
      <DarkScreen scroll keyboard>
        <ScreenHeader
          title={t(`developers.labelTitle.${mode}`)}
          subtitle={t('developers.labelSubtitle')}
          onBack={backToList}
        />
        <View style={styles.body}>
          <GlassCard style={styles.card}>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder={t('developers.labelPlaceholder')}
              placeholderTextColor={colors.ui.ink(0.25)}
              maxLength={60}
              autoFocus
              returnKeyType="done"
            />
          </GlassCard>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PillButton
            style={styles.labelButton}
            label={mode === 'live' ? t('common.continue') : t(`developers.createKey.${mode}`)}
            loading={submitting}
            disabled={label.trim().length === 0}
            onPress={() => {
              setError(null);
              if (mode === 'live') {
                setPin('');
                setPinError(null);
                setStep('pin');
              } else {
                create();
              }
            }}
          />
        </View>
      </DarkScreen>
    );
  }

  return (
    <DarkScreen scroll>
      <ScreenHeader
        title={t('developers.title')}
        subtitle={t('developers.subtitle')}
        onBack={() => navigation.goBack()}
      />

      <View style={styles.body}>
        <View style={styles.modeRow}>
          {MODES.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeChip, mode === m && styles.modeChipActive]}
              onPress={() => setMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === m }}
            >
              <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                {t(`developers.mode.${m}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.explainer}>{t(`developers.explainer.${mode}`)}</Text>

        {needsAccess && liveAccess ? (
          liveAccess.status === 'pending' ? (
            <GlassCard style={styles.accessCard}>
              <Text style={styles.accessTitle}>{t('developers.access.pendingTitle')}</Text>
              <Text style={styles.accessBody}>
                {t('developers.access.pendingBody', {
                  date: liveAccess.requestedAt ? shortDate(liveAccess.requestedAt) : '',
                })}
              </Text>
              {liveAccess.purpose ? <Text style={styles.accessQuote}>“{liveAccess.purpose}”</Text> : null}
            </GlassCard>
          ) : (
            <>
              <GlassCard style={styles.accessCard}>
                <Text style={styles.accessTitle}>{t(`developers.access.title.${liveAccess.status}`)}</Text>
                {liveAccess.note ? (
                  <Text style={styles.accessQuote}>{t('developers.access.note', { note: liveAccess.note })}</Text>
                ) : null}
                <Text style={styles.accessBody}>{t(`developers.access.body.${liveAccess.status}`)}</Text>
              </GlassCard>
              <Text style={styles.label}>{t('developers.access.purposeLabel')}</Text>
              <GlassCard style={styles.card}>
                <TextInput
                  style={[styles.input, styles.purposeInput]}
                  value={purpose}
                  onChangeText={setPurpose}
                  placeholder={t('developers.access.purposePlaceholder')}
                  placeholderTextColor={colors.ui.ink(0.25)}
                  maxLength={LIVE_PURPOSE_MAX}
                  multiline
                  textAlignVertical="top"
                />
              </GlassCard>
              {accessError ? <Text style={styles.error}>{accessError}</Text> : null}
              <PillButton
                style={styles.createButton}
                label={t('developers.access.request')}
                loading={requesting}
                disabled={purpose.trim().length < LIVE_PURPOSE_MIN}
                onPress={askForAccess}
              />
            </>
          )
        ) : (
          <>
          <Text style={styles.label}>{t(`developers.keysLabel.${mode}`)}</Text>
          {loadFailed ? (
            <GlassCard style={styles.emptyCard}>
              <Text style={styles.error}>{t('developers.loadFailed')}</Text>
              <TouchableOpacity onPress={load} style={styles.retry}>
                <Text style={styles.retryText}>{t('common.tryAgain')}</Text>
              </TouchableOpacity>
            </GlassCard>
          ) : keys === null ? (
            <ActivityIndicator color={colors.ui.text} style={styles.spinner} />
          ) : active.length === 0 ? (
            <GlassCard style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t(`developers.empty.${mode}`)}</Text>
            </GlassCard>
          ) : (
            active.map((key) => (
              <GlassCard key={key.keyId} style={styles.keyCard}>
                <View style={styles.keyTop}>
                  <Text style={styles.keyLabel} numberOfLines={1}>
                    {key.label}
                  </Text>
                  <TouchableOpacity
                    onPress={() => confirmRevoke(key)}
                    disabled={revoking === key.keyId}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {revoking === key.keyId ? (
                      <ActivityIndicator color={colors.ui.error} size="small" />
                    ) : (
                      <Text style={styles.revokeText}>{t('developers.revoke')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
                <Text style={styles.hint}>{key.hint}</Text>
                <Text style={styles.meta}>
                  {t('developers.created', { date: shortDate(key.createdAt) })}
                  {' · '}
                  {key.lastUsedAt
                    ? t('developers.lastUsed', { date: shortDate(key.lastUsedAt) })
                    : t('developers.neverUsed')}
                </Text>
              </GlassCard>
            ))
          )}

          {atLimit ? (
            <Text style={styles.hintText}>{t('developers.limitReached', { count: MAX_ACTIVE_KEYS_PER_MODE })}</Text>
          ) : null}

          <PillButton
            style={styles.createButton}
            label={t(`developers.createKey.${mode}`)}
            disabled={atLimit || keys === null}
            onPress={() => {
              setError(null);
              setLabel('');
              setStep('label');
            }}
          />

          </>
        )}

        <Text style={styles.hintText}>{t('developers.keepSafe')}</Text>
        <Text style={styles.hintText}>{t('developers.neverAsk')}</Text>
        <Text style={styles.label}>{t('developers.baseUrlLabel')}</Text>
        <Text style={styles.baseUrl} selectable>
          {apiBaseUrl()}
        </Text>
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48, gap: 6 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  createdContent: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 48 },
  createdHead: { alignItems: 'center', marginBottom: 24 },
  bigTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ui.text,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 20,
  },
  sub: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center', marginTop: 6 },
  pinInput: { marginTop: 28 },
  pinError: { fontSize: 14, color: colors.ui.error, textAlign: 'center', marginTop: 16 },
  spinner: { marginTop: 20 },
  block: { alignSelf: 'stretch', marginTop: 28 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  modeChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ui.glassBorderStrong,
  },
  modeChipActive: { backgroundColor: colors.ui.accent, borderColor: colors.ui.accent },
  modeText: { fontSize: 14, fontWeight: '700', color: colors.ui.textDim },
  modeTextActive: { color: '#FFFFFF' },
  explainer: { fontSize: 13, color: colors.ui.textDim, lineHeight: 19, marginTop: 12 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.ui.textFaint,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 8,
  },
  emptyCard: { padding: 18, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, color: colors.ui.textDim, textAlign: 'center' },
  keyCard: { padding: 16, marginBottom: 8, gap: 6 },
  keyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  keyLabel: { fontSize: 16, fontWeight: '700', color: colors.ui.text, flexShrink: 1 },
  revokeText: { fontSize: 14, fontWeight: '700', color: colors.ui.error },
  hint: { fontSize: 13, color: colors.ui.ink(0.7), fontFamily: 'Menlo', writingDirection: 'ltr' },
  meta: { fontSize: 12, color: colors.ui.textFaint },
  createButton: { marginTop: 16 },
  accessCard: { padding: 18, marginTop: 20, gap: 8 },
  accessTitle: { fontSize: 16, fontWeight: '700', color: colors.ui.text },
  accessBody: { fontSize: 14, color: colors.ui.textDim, lineHeight: 20 },
  accessQuote: { fontSize: 14, color: colors.ui.ink(0.75), lineHeight: 20, fontStyle: 'italic' },
  purposeInput: { minHeight: 96 },
  hintText: { fontSize: 12, color: colors.ui.textFaint, marginTop: 12, lineHeight: 17 },
  baseUrl: { fontSize: 13, color: colors.ui.ink(0.7), fontFamily: 'Menlo', writingDirection: 'ltr' },
  card: { padding: 0, marginTop: 8 },
  input: { fontSize: 16, color: colors.ui.text, padding: 16 },
  labelButton: { marginTop: 20 },
  error: { fontSize: 13, color: colors.ui.error, marginTop: 12 },
  retry: { paddingVertical: 4 },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.ui.text },
  secretCard: { padding: 18 },
  secret: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.ui.text,
    fontFamily: 'Menlo',
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  warning: { fontSize: 13, color: colors.ui.warning, lineHeight: 19, marginTop: 12 },
  actions: { gap: 12, marginTop: 28 },
}));
