import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initData } from './src/data/api';
import { useAppStore } from './src/data/store';
import { setupPwa, updateThemeColorMeta } from './src/pwa';
import type { RootStackParamList } from './src/navigation/types';
import { AuthScreen } from './src/screens/AuthScreen';
import { DesktopLayout } from './src/screens/DesktopLayout';
import { HomeScreen } from './src/screens/HomeScreen';
import { ListScreen } from './src/screens/ListScreen';
import { TaskDetailScreen } from './src/screens/TaskDetailScreen';
import {
  loadThemePref,
  ThemeColors,
  useThemeColors,
  useThemedStyles,
} from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

function Splash() {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.splashText}>My Tasks</Text>
    </View>
  );
}

export default function App() {
  const colors = useThemeColors();
  const authReady = useAppStore((s) => s.authReady);
  const dataReady = useAppStore((s) => s.dataReady);
  const user = useAppStore((s) => s.user);
  const mode = useAppStore((s) => s.mode);
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  useEffect(() => {
    setupPwa();
    loadThemePref();
    initData().catch((e) => console.warn('Failed to initialize data', e));
  }, []);

  useEffect(() => {
    updateThemeColorMeta(colors.dark ? colors.background : colors.primary);
  }, [colors]);

  const navTheme = useMemo(() => {
    const base = colors.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.background,
        card: colors.surface,
        primary: colors.primary,
      },
    };
  }, [colors]);

  let body: React.ReactNode;
  if (!authReady || (user && !dataReady)) {
    body = <Splash />;
  } else if (mode === 'cloud' && !user) {
    body = <AuthScreen />;
  } else if (isWide) {
    body = <DesktopLayout />;
  } else {
    body = (
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="List" component={ListScreen} />
          <Stack.Screen name="Task" component={TaskDetailScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={colors.dark ? 'light' : 'dark'} />
      {body}
    </SafeAreaProvider>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    splash: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    splashText: {
      marginTop: 14,
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
  });
