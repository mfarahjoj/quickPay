import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

export const TAB_ICONS = {
  dashboard: '\u2302',
  scan: '\u{1F4F7}',
  history: '\u2261',
  settings: '\u2699',
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
