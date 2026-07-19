import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';

type ToastType = 'success' | 'info' | 'error';

interface ToastState {
  message: string;
  type: ToastType;
  visible: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState>({ message: '', type: 'info', visible: false });
  const translateY = useRef(new Animated.Value(-80)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(translateY, { toValue: -80, duration: 250, useNativeDriver: true }).start(() => {
      setToast((t) => ({ ...t, visible: false }));
    });
  }, [translateY]);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToast({ message, type, visible: true });
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      hideTimer.current = setTimeout(hide, 3000);
    },
    [hide, translateY],
  );

  const bg =
    toast.type === 'success'
      ? colors.success
      : toast.type === 'error'
        ? colors.dark.error
        : colors.dark.accent;

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast.visible && (
        <Animated.View
          style={[styles.toast, { top: insets.top + spacing.sm, backgroundColor: bg, transform: [{ translateY }] }]}
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{toast.message}</Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    zIndex: 9999,
  },
  toastText: {
    ...typography.bodySemibold,
    color: colors.text.inverse,
    textAlign: 'center',
  },
});
