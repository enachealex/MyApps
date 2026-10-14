import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ListPane } from '../components/ListPane';
import { ListSelection, Sidebar } from '../components/Sidebar';
import { TaskDetailPane } from '../components/TaskDetailPane';
import { ThemeColors, useThemedStyles } from '../theme';

/**
 * Microsoft To Do–style wide layout: navigation sidebar on the left, the
 * selected list in the main pane, and the task detail as a right-side panel.
 */
export function DesktopLayout() {
  const { styles } = useThemedStyles(createStyles);
  const [selection, setSelection] = useState<ListSelection>({ smart: 'myday' });
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const select = useCallback((sel: ListSelection) => {
    setSelection(sel);
    setOpenTaskId(null);
  }, []);

  const closeTask = useCallback(() => setOpenTaskId(null), []);
  const goMyDay = useCallback(() => select({ smart: 'myday' }), [select]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.row}>
        <View style={styles.sidebar}>
          <Sidebar selection={selection} onSelect={select} onOpenTask={setOpenTaskId} />
        </View>
        <View style={styles.main}>
          <ListPane
            key={selection.listId ?? selection.smart}
            listId={selection.listId}
            smart={selection.smart}
            onOpenTask={(id) => setOpenTaskId((cur) => (cur === id ? null : id))}
            onMissing={goMyDay}
          />
        </View>
        {openTaskId != null && (
          <View style={styles.detail}>
            <TaskDetailPane
              key={openTaskId}
              taskId={openTaskId}
              onClose={closeTask}
              dismissIcon="chevron-forward"
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 280,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  main: {
    flex: 1,
  },
  detail: {
    width: 360,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    backgroundColor: colors.background,
  },
});
