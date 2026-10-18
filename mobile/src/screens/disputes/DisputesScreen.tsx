/** Help & disputes: every dispute you raised, live, newest first. */

import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header, EmptyState } from '../../components';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { useMyDisputes, Dispute } from '../../services/dispute.service';
import { DisputeStatusPill, money } from './shared';

interface Props {
  navigation: any;
}

function Row({ dispute, onPress }: { dispute: Dispute; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{t(`disputes.kind.${dispute.kind}`)}</Text>
        <Text style={styles.rowSub}>
          {money(dispute.amountCents)} · {dispute.createdAt.toLocaleDateString()}
        </Text>
      </View>
      <DisputeStatusPill status={dispute.status} />
    </TouchableOpacity>
  );
}

export default function DisputesScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { disputes, loading, error } = useMyDisputes();

  return (
    <View style={styles.container}>
      <Header title={t('disputes.list.title')} onBack={() => navigation.goBack()} />
      <Text style={styles.howTo}>{t('disputes.list.howTo')}</Text>
      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.dark.accent} />
      ) : error ? (
        <Text style={styles.error}>{t('disputes.error.generic')}</Text>
      ) : disputes.length === 0 ? (
        <EmptyState
          variant="notifications"
          title={t('disputes.list.emptyTitle')}
          message={t('disputes.list.emptyMessage')}
        />
      ) : (
        <FlatList
          data={disputes}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <Row dispute={item} onPress={() => navigation.navigate('DisputeDetail', { disputeId: item.id })} />
          )}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  howTo: {
    ...typography.caption,
    color: colors.dark.textDim,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  loader: { marginTop: spacing.xl },
  error: { ...typography.body, color: colors.dark.textDim, textAlign: 'center', marginTop: spacing.xl },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    marginBottom: spacing.sm,
  },
  rowMain: { flex: 1, marginRight: spacing.sm },
  rowTitle: { ...typography.bodySemibold, color: colors.dark.text },
  rowSub: { ...typography.caption, color: colors.dark.textDim, marginTop: 2 },
});
