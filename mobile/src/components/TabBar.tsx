import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography } from '../theme';

export const TAB_ICONS = {
  home: '⌂',
  transactions: '≡',
  profile: '👤',
};

interface TabIconProps {
  name: keyof typeof TAB_ICONS;
  focused: boolean;
  color?: string;
}

export function TabIcon({ name, focused, color }: TabIconProps) {
  const iconColor = color ?? (focused ? colors.primary : colors.border.dark);
  return (
    <View style={styles.container}>
      <Text style={[styles.icon, { color: iconColor }]}>
        {TAB_ICONS[name]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    fontSize: 22,
    fontWeight: '600',
  },
});
