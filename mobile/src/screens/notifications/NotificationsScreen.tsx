import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { EmptyState } from '../../components/EmptyState';
import { useNotifications } from '../../hooks/useNotifications';
import { typography, spacing, makeStyles, useColors } from '../../theme';
import { MoneyInIcon, MoneyOutIcon, CardIcon, BankIcon, BellIcon } from '../../components/icons/UIIcons';
import type { AppNotification } from '../../hooks/useNotifications';

interface Props {
  navigation: any;
}

function NotificationIcon({ type }: { type: AppNotification['type'] }) {
  const colors = useColors();
  const size = 22;
  switch (type) {
    case 'payment_received':
      return <MoneyInIcon size={size} color={colors.ui.incoming} />;
    case 'payment_sent':
      return <MoneyOutIcon size={size} color={colors.ui.textDim} />;
    case 'topup_completed':
      return <CardIcon size={size} color={colors.ui.accentText} />;
    case 'settlement_completed':
      return <BankIcon size={size} color={colors.ui.accentText} />;
    default:
      return <BellIcon size={size} color={colors.ui.textDim} />;
  }
}

function NotificationItem({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.notificationItem, !item.read && styles.unread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        <NotificationIcon type={item.type} />
      </View>
      <View style={styles.notificationContent}>
        <Text style={styles.notificationTitle}>{item.title}</Text>
        <Text style={styles.notificationBody} numberOfLines={2}>
          {item.body}
        </Text>
        <Text style={styles.notificationTime}>
          {item.createdAt.toLocaleDateString()} {item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function NotificationsScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const {
    notifications,
    unreadCount,
    loading,
    error,
    markAsRead,
    markAllAsRead,
  } = useNotifications();

  return (
    <View style={styles.container}>
      <Header title={t('notifications.title')} onBack={() => navigation.goBack()} />

      {unreadCount > 0 && (
        <View style={styles.markAllBar}>
          <Text style={styles.unreadText}>
            {t('notifications.unread', { count: unreadCount })}
          </Text>
          <TouchableOpacity onPress={markAllAsRead}>
            <Text style={styles.markAllText}>{t('notifications.markAllRead')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.ui.accent} />
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : notifications.length === 0 ? (
        <EmptyState
          variant="notifications"
          title={t('notifications.emptyTitle')}
          message={t('notifications.emptyMessage')}
        />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NotificationItem
              item={item}
              onPress={() => markAsRead(item.id)}
            />
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ui.canvas,
  },
  markAllBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.ui.glass,
    borderBottomWidth: 1,
    borderBottomColor: colors.ui.divider,
  },
  unreadText: {
    ...typography.caption,
    color: colors.ui.textDim,
  },
  markAllText: {
    ...typography.bodySemibold,
    color: colors.ui.accentText,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorText: {
    ...typography.body,
    color: colors.ui.error,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  notificationItem: {
    flexDirection: 'row',
    padding: spacing.lg,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: 12,
    alignItems: 'flex-start',
  },
  unread: {
    backgroundColor: colors.ui.accentSoft,
    borderColor: colors.ui.accentBorder,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.ui.glassRaised,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    ...typography.bodySemibold,
    color: colors.ui.text,
    marginBottom: spacing.xs,
  },
  notificationBody: {
    ...typography.body,
    color: colors.ui.textDim,
    marginBottom: spacing.xs,
  },
  notificationTime: {
    ...typography.overline,
    color: colors.ui.textFaint,
  },
}));
