import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
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

interface Props {
  accentColor: string;
  placeholder?: string;
  onAdd: (title: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function AddTaskBar({ accentColor, placeholder = 'Add a task', onAdd, style }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [text, setText] = useState('');

  const submit = () => {
    const title = text.trim();
    if (!title) return;
    onAdd(title);
    setText('');
  };

  return (
    <View style={[styles.bar, style]}>
      <Ionicons name="add" size={24} color={accentColor} />
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
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
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
