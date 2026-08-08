import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { IconName } from '../constants';
import { api } from '../data/api';
import { useAppStore } from '../data/store';
import { promptInstall, useInstallStore } from '../pwa';
import {
  setHaptics,
  setThemePref,
  ThemeColors,
  ThemePref,
  useThemedStyles,
  useThemeStore,
} from '../theme';
import { showMessage } from '../utils/ui';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const THEME_OPTIONS: { pref: ThemePref; label: string; icon: IconName }[] = [
  { pref: 'system', label: 'Use device theme', icon: 'contrast-outline' },
  { pref: 'light', label: 'Light', icon: 'sunny-outline' },
  { pref: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export function AccountSheet({ visible, onClose }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const user = useAppStore((s) => s.user);
  const mode = useAppStore((s) => s.mode);
  const themePref = useThemeStore((s) => s.pref);
  const haptics = useThemeStore((s) => s.haptics);
  const canInstall = useInstallStore((s) => s.canInstall);

  const signOut = async () => {
    try {
      onClose();
      await api.signOutUser();
    } catch (e) {
      showMessage('Could not sign out', e instanceof Error ? e.message : String(e));
    }
  };

  if (!user) return null;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.profileRow}>
          <Avatar id={user.id} name={user.name} size={48} />
          <View style={styles.profileText}>
            <Text style={styles.name}>{user.name}</Text>
            {user.email && <Text style={styles.email}>{user.email}</Text>}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.themeGroup}>
          {THEME_OPTIONS.map((option) => {
            const active = themePref === option.pref;
            return (
              <Pressable
                key={option.pref}
                style={({ pressed }) => [styles.themeRow, pressed && styles.themeRowPressed]}
                onPress={() => setThemePref(option.pref)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Ionicons
                  name={option.icon}
                  size={19}
                  color={active ? colors.primary : colors.textSecondary}
                />
                <Text style={[styles.themeLabel, active && { color: colors.primary }]}>
                  {option.label}
                </Text>
                {active && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Completing tasks</Text>
        <View style={styles.themeGroup}>
          <Pressable
            style={({ pressed }) => [styles.themeRow, pressed && styles.themeRowPressed]}
            onPress={() => setHaptics(!haptics)}
            accessibilityRole="switch"
            accessibilityState={{ checked: haptics }}
          >
            <Ionicons
              name="pulse-outline"
              size={19}
              color={haptics ? colors.primary : colors.textSecondary}
            />
            <Text style={[styles.themeLabel, haptics && { color: colors.primary }]}>
              Vibration & haptics
            </Text>
            <Ionicons
              name={haptics ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={haptics ? colors.primary : colors.textTertiary}
            />
          </Pressable>
        </View>

        {canInstall && (
          <Pressable
            style={({ pressed }) => [styles.installRow, pressed && styles.themeRowPressed]}
            onPress={promptInstall}
          >
            <Ionicons name="download-outline" size={20} color={colors.primary} />
            <Text style={styles.installLabel}>Install app on this device</Text>
          </Pressable>
        )}

        {mode === 'local' ? (
          <View style={styles.localBox}>
            <Ionicons name="phone-portrait-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.localText}>
              Local mode — your tasks live on this device only. To sync across devices and share
              lists with friends, add a Firebase config (see README.md).
            </Text>
          </View>
        ) : (
          <Pressable style={styles.signOut} onPress={signOut}>
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    body: {
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    profileText: {
      marginLeft: 14,
    },
    name: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    email: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 20,
      marginBottom: 6,
    },
    themeGroup: {
      backgroundColor: colors.background,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    themeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    themeRowPressed: {
      backgroundColor: colors.pressed,
    },
    themeLabel: {
      flex: 1,
      fontSize: 14,
      color: colors.text,
      marginLeft: 12,
    },
    installRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 14,
      paddingVertical: 10,
    },
    installLabel: {
      fontSize: 14,
      color: colors.primary,
      fontWeight: '500',
    },
    localBox: {
      flexDirection: 'row',
      gap: 10,
      backgroundColor: colors.background,
      borderRadius: 6,
      padding: 12,
      marginTop: 18,
    },
    localText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    signOut: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 18,
      paddingVertical: 10,
    },
    signOutText: {
      color: colors.danger,
      fontSize: 15,
    },
  });
