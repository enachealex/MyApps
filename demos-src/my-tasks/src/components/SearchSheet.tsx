import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppStore } from '../data/store';
import { ThemeColors, useThemedStyles } from '../theme';
import type { Task } from '../types';
import { formatDueDate, formatTimestamp } from '../utils/dates';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}

const MAX_RESULTS = 50;

/** Searches titles, notes, and steps — completed history included. */
export function SearchSheet({ visible, onClose, onOpenTask }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);

  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matches = tasks.filter((t) => {
      const haystack = `${t.title}\n${t.notes}\n${t.steps.map((s) => s.title).join('\n')}`;
      return haystack.toLowerCase().includes(q);
    });
    matches.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.completed && b.completed) return (b.completedAt ?? 0) - (a.completedAt ?? 0);
      return b.updatedAt - a.updatedAt;
    });
    return matches.slice(0, MAX_RESULTS);
  }, [tasks, query]);

  const listNameOf = (id: string) => lists.find((l) => l.id === id)?.name ?? '';

  const open = (task: Task) => {
    onClose();
    onOpenTask(task.id);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Search">
      <View style={styles.body}>
        <View style={styles.inputRow}>
          <Ionicons name="search" size={17} color={colors.textSecondary} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search tasks, notes, steps…"
            placeholderTextColor={colors.textSecondary}
            autoFocus
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable hitSlop={8} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={17} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>

        <FlatList
          data={results}
          keyExtractor={(t) => t.id}
          style={styles.results}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => open(item)}
            >
              <Ionicons
                name={item.completed ? 'checkmark-circle' : 'ellipse-outline'}
                size={19}
                color={item.completed ? colors.primary : colors.textTertiary}
              />
              <View style={styles.rowBody}>
                <Text
                  style={[styles.rowTitle, item.completed && styles.rowTitleDone]}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {listNameOf(item.listId)}
                  {item.completed && item.completedAt
                    ? ` · done ${formatTimestamp(item.completedAt)}`
                    : item.dueDate
                      ? ` · due ${formatDueDate(item.dueDate)}`
                      : ''}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            query.trim().length > 0 ? (
              <Text style={styles.empty}>No tasks match "{query.trim()}".</Text>
            ) : (
              <Text style={styles.empty}>
                Find anything you've ever added — including completed tasks.
              </Text>
            )
          }
        />
      </View>
    </Sheet>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    body: {
      paddingHorizontal: 20,
      height: 440,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.surface,
    },
    input: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      paddingVertical: 10,
    },
    results: {
      flex: 1,
      marginTop: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 9,
      paddingHorizontal: 4,
      borderRadius: 6,
    },
    rowPressed: {
      backgroundColor: colors.pressed,
    },
    rowBody: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 14,
      color: colors.text,
    },
    rowTitleDone: {
      textDecorationLine: 'line-through',
      color: colors.textSecondary,
    },
    rowMeta: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 1,
    },
    empty: {
      fontSize: 13,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: 24,
      paddingHorizontal: 20,
    },
  });
