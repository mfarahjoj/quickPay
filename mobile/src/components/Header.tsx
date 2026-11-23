import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { typography, spacing, makeStyles } from '../theme';
import { SafeAreaView } from './SafeAreaView';

interface HeaderProps {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

export function Header({ title, onBack, rightAction }: HeaderProps) {
  const styles = useStyles();
  // Screens that hide the navigator's bar put this header at the very top,
  // under the status bar. The safe area pads only what actually overlaps it,
  // so a header below a navigator bar gets no extra space.
  return (
    <SafeAreaView>
      <View style={styles.container}>
        <View style={styles.left}>
          {onBack ? (
            <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={12}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.placeholder} />
          )}
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.right}>
          {rightAction ?? <View style={styles.placeholder} />}
        </View>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  left: {
    width: 44,
    alignItems: 'flex-start',
  },
  right: {
    width: 44,
    alignItems: 'flex-end',
  },
  backButton: {
    padding: spacing.xs,
  },
  backIcon: {
    fontSize: 24,
    color: colors.text.primary,
    fontWeight: '600',
  },
  title: {
    flex: 1,
    ...typography.h3,
    color: colors.text.primary,
    textAlign: 'center',
  },
  placeholder: {
    width: 24,
    height: 24,
  },
}));
