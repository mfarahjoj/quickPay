import { useState, useEffect } from 'react';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from './useAuth';
import { logger } from '../utils/logger';

export interface AppNotification {
  id: string;
  userId: string;
  type: 'payment_received' | 'payment_sent' | 'topup_completed' | 'settlement_completed';
  title: string;
  body: string;
  data?: Record<string, string>;
  read: boolean;
  createdAt: Date;
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    const unsubscribe = firestore()
      .collection('notifications')
      .where('userId', '==', user.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .onSnapshot(
        (snapshot) => {
          const items: AppNotification[] = snapshot.docs.map((doc) => {
            const d = doc.data();
            return {
              id: doc.id,
              userId: d.userId,
              type: d.type,
              title: d.title,
              body: d.body,
              data: d.data,
              read: d.read ?? false,
              createdAt: d.createdAt?.toDate?.() ?? new Date(),
            };
          });
          setNotifications(items);
          setUnreadCount(items.filter((n) => !n.read).length);
          setError(null);
        },
        (err) => {
          setError(err.message);
        }
      );

    setLoading(false);

    return () => unsubscribe();
  }, [user?.uid]);

  const markAsRead = async (notificationId: string) => {
    if (!user?.uid) return;
    try {
      await firestore().collection('notifications').doc(notificationId).update({
        read: true,
      });
    } catch (err) {
      logger.error('Failed to mark notification as read:', err);
    }
  };

  const markAllAsRead = async () => {
    if (!user?.uid) return;
    const batch = firestore().batch();
    const unread = notifications.filter((n) => !n.read);
    unread.forEach((n) => {
      batch.update(firestore().collection('notifications').doc(n.id), {
        read: true,
      });
    });
    try {
      await batch.commit();
    } catch (err) {
      logger.error('Failed to mark all as read:', err);
    }
  };

  return {
    notifications,
    unreadCount,
    loading,
    error,
    markAsRead,
    markAllAsRead,
  };
}
