import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

interface Props {
  checked: boolean;
  color: string;
  onToggle: () => void;
  size?: number;
  /** Locked (blocked task / out-of-order step): dimmed, shows a lock. */
  locked?: boolean;
}

export function TaskCheckbox({ checked, color, onToggle, size = 22, locked }: Props) {
  return (
    <Pressable
      hitSlop={10}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: locked }}
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, borderColor: color },
        checked && { backgroundColor: color },
        locked && !checked && styles.locked,
      ]}
    >
      {checked && <Ionicons name="checkmark" size={size * 0.65} color="#fff" />}
      {!checked && locked && <Ionicons name="lock-closed" size={size * 0.55} color={color} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: {
    opacity: 0.55,
  },
});
