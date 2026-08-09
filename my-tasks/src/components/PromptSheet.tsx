import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ThemeColors, useThemedStyles } from '../theme';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  placeholder?: string;
  initialValue?: string;
  saveLabel?: string;
  onSave: (value: string) => void;
}

/** A one-field text prompt (new section, rename section, …). */
export function PromptSheet({
  visible,
  onClose,
  title,
  placeholder,
  initialValue = '',
  saveLabel = 'Save',
  onSave,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const save = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSave(trimmed);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.body}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          autoFocus
          onSubmitEditing={save}
          returnKeyType="done"
        />
        <Pressable
          style={[styles.button, !value.trim() && styles.buttonDisabled]}
          onPress={save}
          disabled={!value.trim()}
        >
          <Text style={styles.buttonText}>{saveLabel}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    body: {
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
      backgroundColor: colors.surface,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 6,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 14,
    },
    buttonDisabled: {
      opacity: 0.4,
    },
    buttonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
  });
