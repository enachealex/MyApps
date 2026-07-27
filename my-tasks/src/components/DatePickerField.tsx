import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ThemeColors, useThemedStyles } from '../theme';
import { parseDateStr, toDateStr, todayStr } from '../utils/dates';

export interface DatePickerFieldProps {
  value: string | null;
  onPick: (date: string) => void;
  onCancel: () => void;
}

/**
 * Native date picker: a dialog on Android, an inline spinner with
 * Cancel/Done on iOS. (Web uses DatePickerField.web.tsx.)
 */
export function DatePickerField({ value, onPick, onCancel }: DatePickerFieldProps) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [temp, setTemp] = useState(() => parseDateStr(value ?? todayStr()));

  if (Platform.OS === 'android') {
    return (
      <DateTimePicker
        mode="date"
        value={temp}
        onChange={(event, date) => {
          if (event.type === 'set' && date) onPick(toDateStr(date));
          else onCancel();
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <DateTimePicker
        mode="date"
        display="spinner"
        themeVariant={colors.dark ? 'dark' : 'light'}
        value={temp}
        onChange={(_event, date) => {
          if (date) setTemp(date);
        }}
      />
      <View style={styles.buttons}>
        <Pressable onPress={onCancel} style={styles.button}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={() => onPick(toDateStr(temp))} style={styles.button}>
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
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
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
