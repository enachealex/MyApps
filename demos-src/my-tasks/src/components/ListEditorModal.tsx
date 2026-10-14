import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { listColors, ThemeColors, useThemedStyles } from '../theme';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  saveLabel: string;
  initialName?: string;
  initialColor?: string;
  /** The built-in "Tasks" list keeps its name. */
  nameEditable?: boolean;
  onSave: (name: string, color: string) => void;
}

export function ListEditorModal({
  visible,
  onClose,
  title,
  saveLabel,
  initialName = '',
  initialColor = listColors[0],
  nameEditable = true,
  onSave,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setColor(initialColor);
    }
  }, [visible, initialName, initialColor]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, color);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.body}>
        <TextInput
          style={[styles.input, !nameEditable && styles.inputDisabled]}
          value={name}
          onChangeText={setName}
          placeholder="List name"
          placeholderTextColor={colors.textSecondary}
          autoFocus={nameEditable}
          editable={nameEditable}
          onSubmitEditing={save}
          returnKeyType="done"
        />
        <View style={styles.swatches}>
          {listColors.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={[styles.swatch, { backgroundColor: c }]}
            >
              {color === c && <Ionicons name="checkmark" size={16} color="#fff" />}
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.saveButton, { backgroundColor: color }, !name.trim() && styles.saveDisabled]}
          onPress={save}
          disabled={!name.trim()}
        >
          <Text style={styles.saveText}>{saveLabel}</Text>
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
  inputDisabled: {
    color: colors.textTertiary,
    backgroundColor: colors.background,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    marginTop: 20,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveDisabled: {
    opacity: 0.4,
  },
  saveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
