import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useThemeStore } from './theme';

/**
 * Sensory feedback for completing a task. Honors the "Vibration & haptics"
 * toggle in the profile sheet.
 *
 * SOUND HOOK: when audio files exist, drop them in assets/sounds/ and play
 * them from here (expo-audio on native, HTMLAudioElement on web) so every
 * completion path gets the same treatment. Until then, sound is a no-op.
 */
export function completionFeedback(): void {
  if (!useThemeStore.getState().haptics) return;
  if (Platform.OS === 'web') {
    try {
      // Android Chrome only; a silent no-op elsewhere.
      navigator.vibrate?.([18, 40, 24]);
    } catch {
      // Vibration is a nicety, never an error.
    }
  } else {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }
}
