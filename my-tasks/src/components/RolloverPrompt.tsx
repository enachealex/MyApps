import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../data/api';
import { overdueTasks, useAppStore } from '../data/store';
import { ThemeColors, useThemedStyles } from '../theme';
import type { Task } from '../types';
import { addDaysStr, todayStr } from '../utils/dates';
import { showMessage } from '../utils/ui';
import { Sheet, SheetItem } from './Sheet';

const ROLLOVER_KEY = 'my-tasks/rollover-day';

/**
 * Once a day, instead of a demotivating wall of red badges: a batch offer to
 * reschedule or park everything that slipped past its due date.
 */
export function RolloverPrompt() {
  const { styles } = useThemedStyles(createStyles);
  const dataReady = useAppStore((s) => s.dataReady);
  const tasks = useAppStore((s) => s.tasks);

  const [promptedDay, setPromptedDay] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ROLLOVER_KEY)
      .then((v) => setPromptedDay(v))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const today = todayStr();
  const overdue = overdueTasks(tasks);
  const visible =
    loaded && dataReady && !dismissed && promptedDay !== today && overdue.length > 0;

  const markPrompted = () => {
    setDismissed(true);
    setPromptedDay(today);
    AsyncStorage.setItem(ROLLOVER_KEY, today).catch(() => {});
  };

  const applyAll = (patchFor: (task: Task) => Partial<Task>) => {
    markPrompted();
    Promise.all(overdue.map((t) => api.updateTask(t.id, patchFor(t)))).catch((e) =>
      showMessage('Could not update tasks', e instanceof Error ? e.message : String(e))
    );
  };

  return (
    <Sheet visible={visible} onClose={markPrompted} title="Start the day fresh">
      <View style={styles.body}>
        <Text style={styles.text}>
          {overdue.length === 1
            ? '1 task slipped past its due date.'
            : `${overdue.length} tasks slipped past their due dates.`}{' '}
          Reschedule them in one go:
        </Text>
      </View>
      <SheetItem
        icon="sunny-outline"
        label="Move to today"
        onPress={() => applyAll(() => ({ dueDate: today }))}
      />
      <SheetItem
        icon="arrow-forward-circle-outline"
        label="Move to tomorrow"
        onPress={() => applyAll(() => ({ dueDate: addDaysStr(today, 1) }))}
      />
      <SheetItem
        icon="calendar-clear-outline"
        label="Remove the due dates"
        onPress={() => applyAll(() => ({ dueDate: null }))}
      />
      <SheetItem
        icon="file-tray-full-outline"
        label="Park them in Someday"
        onPress={() => applyAll(() => ({ someday: true, dueDate: null, myDayDate: null }))}
      />
      <SheetItem icon="close-outline" label="Keep as is" onPress={markPrompted} />
    </Sheet>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    body: {
      paddingHorizontal: 20,
      paddingBottom: 6,
    },
    text: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
  });
