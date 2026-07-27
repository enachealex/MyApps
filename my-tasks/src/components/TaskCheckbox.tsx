import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

interface Props {
  checked: boolean;
  color: string;
  onToggle: () => void;
  size?: number;
}

export function TaskCheckbox({ checked, color, onToggle, size = 22 }: Props) {
  return (
    <Pressable
      hitSlop={10}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, borderColor: color },
        checked && { backgroundColor: color },
      ]}
    >
      {checked && <Ionicons name="checkmark" size={size * 0.65} color="#fff" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
