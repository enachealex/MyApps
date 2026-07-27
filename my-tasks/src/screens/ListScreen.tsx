import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ListPane } from '../components/ListPane';
import type { RootStackParamList } from '../navigation/types';
import { ThemeColors, useThemedStyles } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'List'>;

/** Phone list screen: one list full-screen, back button next to "Add a task". */
export function ListScreen({ navigation, route }: Props) {
  const { styles } = useThemedStyles(createStyles);
  const { listId, smart } = route.params;
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ListPane
        listId={listId}
        smart={smart}
        onOpenTask={(taskId) => navigation.navigate('Task', { taskId })}
        onBack={() => navigation.goBack()}
        onMissing={() => navigation.goBack()}
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
