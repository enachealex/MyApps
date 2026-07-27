import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../data/api';
import { ThemeColors, useThemedStyles } from '../theme';

function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return e instanceof Error ? e.message : 'Something went wrong. Try again.';
  }
}

export function AuthScreen() {
  const { colors, styles } = useThemedStyles(createStyles);
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && (!isSignUp || name.trim().length > 0);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isSignUp) {
        await api.signUp(name, email, password);
      } else {
        await api.signIn(email, password);
      }
      // Success: the auth listener flips the app into the main UI.
    } catch (e) {
      setError(friendlyAuthError(e));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoBlock}>
            <Ionicons name="checkmark-done-circle" size={64} color={colors.primary} />
            <Text style={styles.appName}>My Tasks</Text>
            <Text style={styles.tagline}>Plan your day and share lists with friends</Text>
          </View>

          <View style={styles.card}>
            {isSignUp && (
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="words"
              />
            )}
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
              onSubmitEditing={submit}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              style={[styles.button, (!canSubmit || busy) && styles.buttonDisabled]}
              onPress={submit}
              disabled={!canSubmit || busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{isSignUp ? 'Create account' : 'Sign in'}</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            onPress={() => {
              setIsSignUp(!isSignUp);
              setError(null);
            }}
            style={styles.switchRow}
          >
            <Text style={styles.switchText}>
              {isSignUp ? 'Already have an account? ' : 'New here? '}
              <Text style={styles.switchLink}>{isSignUp ? 'Sign in' : 'Create an account'}</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: 28,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginTop: 8,
  },
  tagline: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 18,
    boxShadow: '0px 2px 12px rgba(0, 0, 0, 0.08)',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
    marginBottom: 12,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginBottom: 12,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  switchRow: {
    alignItems: 'center',
    marginTop: 20,
  },
  switchText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  switchLink: {
    color: colors.primary,
    fontWeight: '600',
  },
});
