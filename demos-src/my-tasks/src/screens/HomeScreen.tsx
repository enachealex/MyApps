import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sidebar } from '../components/Sidebar';
import type { RootStackParamList } from '../navigation/types';
import { ThemeColors, useThemedStyles } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

/** Phone home screen: the navigation menu as a full-width page. */
export function HomeScreen({ navigation }: Props) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Sidebar
        onSelect={(selection) => navigation.navigate('List', selection)}
        onOpenTask={(taskId) => navigation.navigate('Task', { taskId })}
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
