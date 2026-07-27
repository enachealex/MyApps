import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { IconName } from '../constants';
import { ThemeColors, useThemedStyles } from '../theme';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

/** Bottom sheet built on the core Modal, styled after Microsoft To Do's menus. */
export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoider}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.grabber} />
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {children}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

interface SheetItemProps {
  icon?: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  selected?: boolean;
  rightText?: string;
  right?: React.ReactNode;
}

export function SheetItem({
  icon,
  label,
  onPress,
  destructive,
  selected,
  rightText,
  right,
}: SheetItemProps) {
  const { colors, styles } = useThemedStyles(createStyles);
  const tint = destructive ? colors.danger : selected ? colors.primary : colors.textSecondary;
  const labelColor = destructive ? colors.danger : selected ? colors.primary : colors.text;
  return (
    <Pressable style={({ pressed }) => [styles.item, pressed && styles.itemPressed]} onPress={onPress}>
      {icon ? <Ionicons name={icon} size={20} color={tint} style={styles.itemIcon} /> : null}
      <Text style={[styles.itemLabel, { color: labelColor }]}>{label}</Text>
      {rightText ? <Text style={styles.itemRightText}>{rightText}</Text> : null}
      {right}
      {selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  avoider: {
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 28,
    paddingTop: 6,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  itemPressed: {
    backgroundColor: colors.pressed,
  },
  itemIcon: {
    marginRight: 14,
  },
  itemLabel: {
    fontSize: 15,
    flex: 1,
  },
  itemRightText: {
    fontSize: 13,
    color: colors.textTertiary,
    marginRight: 8,
  },
});
