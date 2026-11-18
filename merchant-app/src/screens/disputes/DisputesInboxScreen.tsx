/**
 * Disputes inbox: claims against the shop that need a reply come first,
 * with their deadline; everything else follows, newest first.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { DarkScreen, ScreenHeader, GlassCard } from '../../components';
import { useAuth } from '../../hooks/useAuth';
import { Dispute, needsReply, useMyDisputes } from '../../services/dispute.service';
import { DisputeStatusPill, money } from './shared';
import { makeStyles, useColors } from '../../theme';

function Row({ d, uid, onPress }: { d: Dispute; uid?: string; onPress: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const reply = needsReply(d, uid);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <GlassCard style={[styles.row, reply && styles.rowUrgent]}>
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle}>{t(`disputes.kind.${d.kind}`)}</Text>
          <Text style={styles.rowSub}>
            {money(d.amountCents)} ·{' '}
            {reply
              ? t('disputes.inbox.replyBy', { date: d.respondBy.toLocaleDateString() })
              : d.createdAt.toLocaleDateString()}
          </Text>
        </View>
        <DisputeStatusPill status={d.status} mine={d.against === uid} />
      </GlassCard>
    </TouchableOpacity>
  );
}

export default function DisputesInboxScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { disputes, loading, error } = useMyDisputes();

  const [urgent, rest] = useMemo(() => {
    const u = disputes.filter((d) => needsReply(d, user?.uid));
    return [u, disputes.filter((d) => !u.includes(d))];
  }, [disputes, user?.uid]);

  const open = (d: Dispute) => navigation.navigate('DisputeDetail', { disputeId: d.id });

  return (
    <DarkScreen scroll>
      <ScreenHeader title={t('disputes.inbox.title')} onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.ui.text} style={styles.loader} />
        ) : error ? (
          <Text style={styles.empty}>{t('disputes.error.generic')}</Text>
        ) : disputes.length === 0 ? (
          <Text style={styles.empty}>{t('disputes.inbox.empty')}</Text>
        ) : (
          <>
            {urgent.length > 0 && (
              <>
                <Text style={styles.section}>{t('disputes.inbox.needsReply')}</Text>
                {urgent.map((d) => (
                  <Row key={d.id} d={d} uid={user?.uid} onPress={() => open(d)} />
                ))}
              </>
            )}
            {rest.length > 0 && (
              <>
                <Text style={styles.section}>{t('disputes.inbox.all')}</Text>
                {rest.map((d) => (
                  <Row key={d.id} d={d} uid={user?.uid} onPress={() => open(d)} />
                ))}
              </>
            )}
          </>
        )}
        <Text style={styles.howTo}>{t('disputes.inbox.howTo')}</Text>
      </View>
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  loader: { marginTop: 32 },
  empty: { fontSize: 15, color: colors.ui.textDim, textAlign: 'center', marginTop: 32 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ui.textFaint,
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 10 },
  rowUrgent: { borderColor: colors.ui.warningSoft },
  rowMain: { flex: 1, marginRight: 10 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.ui.text },
  rowSub: { fontSize: 13, color: colors.ui.textDim, marginTop: 3 },
  howTo: { fontSize: 13, color: colors.ui.textFaint, marginTop: 24, lineHeight: 19 },
}));
