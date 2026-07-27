import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../data/api';
import { ThemeColors, useThemedStyles } from '../theme';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  onJoined: (listId: string) => void;
}

export function JoinSheet({ visible, onClose, onJoined }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setCode('');
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const join = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const listId = await api.joinList(code);
      onClose();
      onJoined(listId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Join a shared list">
      <View style={styles.body}>
        <Text style={styles.hint}>
          Enter the invite code your friend shared with you.
        </Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="e.g. AB3D7K"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={6}
          onSubmitEditing={join}
          returnKeyType="go"
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          style={[styles.button, (!code.trim() || busy) && styles.buttonDisabled]}
          onPress={join}
          disabled={!code.trim() || busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Join list</Text>}
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
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 4,
    color: colors.text,
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginTop: 8,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
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
