/**
 * A Zaad top-up offered to the agent, as a job: what it pays, who for, how
 * long is left, and one big Accept.
 *
 * The request rings on several agents at once and the first to accept gets
 * it. So after tapping Accept the agent sees "checking", then either the job
 * (the screen moves on by itself once the request is theirs) or a plain
 * reason why not. While the offer waits on the agent and the app is in front
 * the phone buzzes; in the background the push does the alerting.
 */

import React, { useEffect, useRef } from 'react';
import { AppState, StyleSheet, Text, Vibration, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PillButton } from './index';
import { formatCents } from '../utils/money';
import { makeStyles } from '../theme';

/** How long the offer rings in all, to size the countdown bar when the doc doesn't say. */
const DEFAULT_WINDOW_MS = 60_000;
const BUZZ_EVERY_MS = 1500;

export type JobPhase = 'deciding' | 'checking' | 'taken' | 'expired';

interface Props {
  amount: number;
  customerFirstName: string;
  /** What the agent earns if it completes, in cents. */
  commissionCents?: number;
  /** Seconds left, ticking, from the offer's shared deadline. */
  secondsLeft: number;
  /** The whole window in ms, for the countdown bar. */
  windowMs?: number;
  phase: JobPhase;
  /** Other offers waiting behind this one. */
  othersWaiting?: number;
  error?: string;
  onAccept: () => void;
  onDecline: () => void;
  /** Leave: after the offer was taken or ran out. */
  onClose: () => void;
}

export function ZaadJobOffer({
  amount,
  customerFirstName,
  commissionCents,
  secondsLeft,
  windowMs = DEFAULT_WINDOW_MS,
  phase,
  othersWaiting = 0,
  error,
  onAccept,
  onDecline,
  onClose,
}: Props) {
  const styles = useStyles();
  const { t } = useTranslation();

  // Buzz while the offer waits on the agent and the app is in front.
  const buzzing = useRef(false);
  useEffect(() => {
    if (phase !== 'deciding' || secondsLeft <= 0) return;
    const buzz = () => {
      if (AppState.currentState === 'active') Vibration.vibrate(400);
    };
    buzz();
    buzzing.current = true;
    const timer = setInterval(buzz, BUZZ_EVERY_MS);
    return () => {
      clearInterval(timer);
      if (buzzing.current) Vibration.cancel();
      buzzing.current = false;
    };
  }, [phase, secondsLeft <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = Math.max(0, Math.min(1, (secondsLeft * 1000) / windowMs));
  const urgent = secondsLeft <= 10;

  if (phase === 'taken' || phase === 'expired') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.endedTitle}>
          {t(phase === 'taken' ? 'zaadTopups.job.takenTitle' : 'zaadTopups.job.expiredTitle')}
        </Text>
        <Text style={styles.sub}>
          {t(phase === 'taken' ? 'zaadTopups.job.takenBody' : 'zaadTopups.job.expiredBody', { amount: formatCents(amount) })}
        </Text>
        <PillButton label={t('zaadTopups.job.back')} onPress={onClose} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('zaadTopups.job.label')}</Text>
      <Text style={styles.amount}>{formatCents(amount)}</Text>
      {commissionCents && commissionCents > 0 ? (
        <View style={styles.earnPill}>
          <Text style={styles.earnText}>{t('zaadTopups.job.earn', { amount: formatCents(commissionCents) })}</Text>
        </View>
      ) : null}
      <Text style={styles.sub}>{t('zaadTopups.job.for', { name: customerFirstName })}</Text>

      <View style={styles.timer}>
        <View style={styles.track}>
          <View style={[styles.fill, urgent && styles.fillUrgent, { width: `${share * 100}%` }]} />
        </View>
        <Text style={[styles.seconds, urgent && styles.secondsUrgent]}>
          {t('zaadTopups.job.secondsLeft', { count: secondsLeft })}
        </Text>
      </View>

      <Text style={styles.hint}>{t('zaadTopups.job.firstWins')}</Text>
      <Text style={styles.hint}>{t('zaadTopups.job.heldNote', { amount: formatCents(amount) })}</Text>
      {othersWaiting > 0 ? <Text style={styles.hint}>{t('zaadTopups.list.othersWaiting', { count: othersWaiting })}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PillButton
        label={t(phase === 'checking' ? 'zaadTopups.job.checking' : 'zaadTopups.offer.accept')}
        onPress={onAccept}
        loading={phase === 'checking'}
        disabled={phase === 'checking' || secondsLeft <= 0}
      />
      <PillButton label={t('zaadTopups.offer.decline')} variant="glass" onPress={onDecline} disabled={phase === 'checking'} />
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  wrap: { paddingHorizontal: 24, gap: 14, alignItems: 'stretch' },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.ui.textFaint, textAlign: 'center' },
  amount: { fontSize: 64, fontWeight: '800', color: colors.ui.text, letterSpacing: -2, textAlign: 'center' },
  earnPill: {
    alignSelf: 'center',
    backgroundColor: colors.ui.incomingSoft,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  earnText: { fontSize: 15, fontWeight: '800', color: colors.ui.incoming },
  sub: { fontSize: 15, lineHeight: 22, color: colors.ui.textDim, textAlign: 'center' },
  hint: { fontSize: 13, lineHeight: 19, color: colors.ui.textFaint, textAlign: 'center' },
  error: { fontSize: 14, color: colors.ui.error, textAlign: 'center' },
  timer: { gap: 8, marginVertical: 4 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.ui.ink(0.12), overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.ui.incoming },
  fillUrgent: { backgroundColor: colors.ui.error },
  seconds: { fontSize: 22, fontWeight: '800', color: colors.ui.text, textAlign: 'center' },
  secondsUrgent: { color: colors.ui.error },
  endedTitle: { fontSize: 24, fontWeight: '800', color: colors.ui.text, textAlign: 'center', marginTop: 20 },
}));
