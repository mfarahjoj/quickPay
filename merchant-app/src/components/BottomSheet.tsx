import React from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { colors, borderRadius } from '../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  height?: number | string;
}

export function BottomSheet({
  visible,
  onClose,
  children,
  height = '50%',
}: BottomSheetProps) {
  const sheetHeight =
    typeof height === 'string'
      ? (SCREEN_HEIGHT * parseInt(height, 10)) / 100
      : height;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.sheet, { height: sheetHeight }]}>
          <View style={styles.handle} />
          <View style={styles.content}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  overlayTouchable: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.background.primary,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border.medium,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  content: {
    flex: 1,
  },
});
