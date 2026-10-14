import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ThemeColors, useThemedStyles } from '../theme';
import { todayStr } from '../utils/dates';
import type { DatePickerFieldProps } from './DatePickerField';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Web fallback: type a date as YYYY-MM-DD. */
export function DatePickerField({ value, onPick, onCancel }: DatePickerFieldProps) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [text, setText] = useState(value ?? todayStr());
  const valid = DATE_RE.test(text.trim());

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textSecondary}
        autoFocus
      />
      <View style={styles.buttons}>
        <Pressable onPress={onCancel} style={styles.button}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => valid && onPick(text.trim())}
          style={[styles.button, !valid && styles.disabled]}
          disabled={!valid}
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    paddingHorizontal: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  disabled: {
    opacity: 0.4,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  doneText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
});
