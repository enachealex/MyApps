import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import type { SmartListId } from './types';

export interface ThemeColors {
  dark: boolean;
  primary: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  danger: string;
  overlay: string;
  /** Feedback color for pressed rows/cards. */
  pressed: string;
  /** Background of the selected sidebar entry. */
  selected: string;
}

export const lightColors: ThemeColors = {
  dark: false,
  primary: '#2564CF',
  background: '#FAF9F8',
  surface: '#FFFFFF',
  text: '#292827',
  textSecondary: '#605E5C',
  textTertiary: '#A19F9D',
  border: '#EDEBE9',
  danger: '#A80000',
  overlay: 'rgba(0, 0, 0, 0.4)',
  pressed: '#F3F2F1',
  selected: '#EAEFF7',
};

/** Fluent-style dark palette, close to Microsoft To Do's dark theme. */
export const darkColors: ThemeColors = {
  dark: true,
  primary: '#479EF5',
  background: '#1B1A19',
  surface: '#252423',
  text: '#F3F2F1',
  textSecondary: '#C8C6C4',
  textTertiary: '#797775',
  border: '#3B3A39',
  danger: '#F1707B',
  overlay: 'rgba(0, 0, 0, 0.55)',
  pressed: '#323130',
  selected: '#2C3E5D',
};

/** List theme colors, close to Microsoft To Do's palette. Stored in list data. */
export const listColors = [
  '#2564CF', // blue
  '#B10E1C', // red
  '#CA5010', // orange
  '#038387', // teal
  '#498205', // green
  '#7719AA', // purple
  '#C239B3', // magenta
  '#69797E', // gray
];

/** Deterministic color for a user's avatar. */
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return listColors[Math.abs(hash) % listColors.length];
}

// --- Theme preference ---------------------------------------------------------

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'my-tasks/theme-pref';
const SMART_BG_KEY = 'my-tasks/smart-backgrounds';
const HAPTICS_KEY = 'my-tasks/haptics';

interface ThemeState {
  pref: ThemePref;
  /** Device-level background choice per smart list (list backgrounds sync as data). */
  smartBackgrounds: Partial<Record<SmartListId, string | null>>;
  /** Vibration/haptics on task completion. */
  haptics: boolean;
}

export const useThemeStore = create<ThemeState>(() => ({
  pref: 'system',
  smartBackgrounds: { myday: 'sunrise' },
  haptics: true,
}));

export async function loadThemePref(): Promise<void> {
  try {
    const [v, bg, haptics] = await Promise.all([
      AsyncStorage.getItem(THEME_KEY),
      AsyncStorage.getItem(SMART_BG_KEY),
      AsyncStorage.getItem(HAPTICS_KEY),
    ]);
    if (v === 'system' || v === 'light' || v === 'dark') {
      useThemeStore.setState({ pref: v });
    }
    if (bg) {
      useThemeStore.setState({
        smartBackgrounds: JSON.parse(bg) as ThemeState['smartBackgrounds'],
      });
    }
    if (haptics != null) {
      useThemeStore.setState({ haptics: haptics === '1' });
    }
  } catch {
    // First run / storage unavailable: keep the defaults.
  }
}

export function setThemePref(pref: ThemePref): void {
  useThemeStore.setState({ pref });
  AsyncStorage.setItem(THEME_KEY, pref).catch(() => {});
}

export function setSmartBackground(id: SmartListId, background: string | null): void {
  const next = { ...useThemeStore.getState().smartBackgrounds, [id]: background };
  useThemeStore.setState({ smartBackgrounds: next });
  AsyncStorage.setItem(SMART_BG_KEY, JSON.stringify(next)).catch(() => {});
}

export function setHaptics(enabled: boolean): void {
  useThemeStore.setState({ haptics: enabled });
  AsyncStorage.setItem(HAPTICS_KEY, enabled ? '1' : '0').catch(() => {});
}

// --- Hooks --------------------------------------------------------------------

export function useThemeColors(): ThemeColors {
  const pref = useThemeStore((s) => s.pref);
  const system = useColorScheme();
  const dark = pref === 'dark' || (pref === 'system' && system === 'dark');
  return dark ? darkColors : lightColors;
}

const styleCache = new WeakMap<object, Map<ThemeColors, unknown>>();

/**
 * Theme-aware replacement for a module-level StyleSheet:
 *
 *   const createStyles = (colors: ThemeColors) => StyleSheet.create({ ... });
 *   const { colors, styles } = useThemedStyles(createStyles);
 *
 * The factory runs once per theme; results are cached.
 */
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): {
  colors: ThemeColors;
  styles: T;
} {
  const colors = useThemeColors();
  let byTheme = styleCache.get(factory);
  if (!byTheme) {
    byTheme = new Map();
    styleCache.set(factory, byTheme);
  }
  let styles = byTheme.get(colors) as T | undefined;
  if (styles === undefined) {
    styles = factory(colors);
    byTheme.set(colors, styles);
  }
  return { colors, styles };
}
