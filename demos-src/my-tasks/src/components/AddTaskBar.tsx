import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { ThemeColors, useThemedStyles } from '../theme';
import { formatDueDate } from '../utils/dates';
import { parseQuickAdd } from '../utils/quickAdd';

export interface QuickAddPayload {
  title: string;
  dueDate: string | null;
  important: boolean;
}

interface Props {
  accentColor: string;
  placeholder?: string;
  onAdd: (payload: QuickAddPayload) => void;
  style?: StyleProp<ViewStyle>;
}

export function AddTaskBar({ accentColor, placeholder = 'Add a task', onAdd, style }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [text, setText] = useState('');
  // Tapping the hint chip opts out of the parsed date for this entry.
  const [useParsedDate, setUseParsedDate] = useState(true);

  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const showHint = text.trim().length > 0 && parsed.dueDate != null;

  const changeText = (t: string) => {
    setText(t);
    if (t.trim().length === 0) setUseParsedDate(true);
  };

  const submit = () => {
    if (!text.trim()) return;
    const applyDate = useParsedDate && parsed.dueDate != null;
    // Opting out of the parsed date keeps the date words in the title.
    const rawTitle = text.replace(/(^|\s)!+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    onAdd({
      title: applyDate ? parsed.title : rawTitle,
      dueDate: applyDate ? parsed.dueDate : null,
      important: parsed.important,
    });
    setText('');
    setUseParsedDate(true);
  };

  return (
    <View style={[styles.container, style]}>
      {showHint && (
        <Pressable style={styles.hintRow} onPress={() => setUseParsedDate((v) => !v)}>
          <Ionicons
            name="calendar-outline"
            size={13}
            color={useParsedDate ? accentColor : colors.textTertiary}
          />
          <Text
            style={[
              styles.hintText,
              { color: useParsedDate ? accentColor : colors.textTertiary },
              !useParsedDate && styles.hintOff,
            ]}
          >
            Due {formatDueDate(parsed.dueDate as string)}
            {parsed.important ? '  ·  important' : ''}
          </Text>
          <Text style={styles.hintAction}>{useParsedDate ? 'tap to keep as text' : 'ignored'}</Text>
        </Pressable>
      )}
      <View style={styles.bar}>
        <Ionicons name="add" size={24} color={accentColor} />
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={changeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          onSubmitEditing={submit}
          submitBehavior="submit"
          blurOnSubmit={false}
          returnKeyType="done"
        />
        {text.trim().length > 0 && (
          <Pressable onPress={submit} hitSlop={8}>
            <Text style={[styles.addLabel, { color: accentColor }]}>Add</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'column',
    },
    hintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surface,
      borderRadius: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      marginBottom: 6,
      boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.10)',
      alignSelf: 'flex-start',
    },
    hintText: {
      fontSize: 12,
      fontWeight: '600',
    },
    hintOff: {
      textDecorationLine: 'line-through',
    },
    hintAction: {
      fontSize: 11,
      color: colors.textTertiary,
      marginLeft: 4,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 4,
      boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.12)',
    },
    input: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      paddingVertical: 12,
      marginLeft: 10,
    },
    addLabel: {
      fontSize: 14,
      fontWeight: '600',
      paddingHorizontal: 6,
    },
  });
