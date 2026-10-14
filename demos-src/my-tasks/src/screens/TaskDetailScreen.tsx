import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TaskDetailPane } from '../components/TaskDetailPane';
import type { RootStackParamList } from '../navigation/types';
import { ThemeColors, useThemedStyles } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Task'>;

/** Phone task detail: full-screen, dismiss button in the bottom bar. */
export function TaskDetailScreen({ navigation, route }: Props) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TaskDetailPane
        taskId={route.params.taskId}
        onClose={() => navigation.goBack()}
        dismissIcon="chevron-back"
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
