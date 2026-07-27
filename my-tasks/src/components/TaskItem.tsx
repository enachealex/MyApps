import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Task } from '../types';
import { ThemeColors, useThemedStyles } from '../theme';
import { formatDueDate, isOverdue, todayStr } from '../utils/dates';
import { TaskCheckbox } from './TaskCheckbox';

interface Props {
  task: Task;
  accentColor: string;
  /** Shown in the meta line when viewing a smart list ("Tasks", "Groceries"…). */
  listName?: string;
  /** Suppress the "My Day" badge (when already inside My Day). */
  hideMyDayBadge?: boolean;
  onPress: () => void;
  onToggle: () => void;
  onToggleImportant: () => void;
}

export function TaskItem({
  task,
  accentColor,
  listName,
  hideMyDayBadge,
  onPress,
  onToggle,
  onToggleImportant,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const meta: React.ReactNode[] = [];
  const push = (node: React.ReactNode) => {
    if (meta.length > 0) {
      meta.push(
        <Text key={`dot${meta.length}`} style={styles.metaDot}>
          {' · '}
        </Text>
      );
    }
    meta.push(node);
  };

  if (listName) {
    push(
      <Text key="list" style={styles.metaText}>
        {listName}
      </Text>
    );
  }
  if (!hideMyDayBadge && task.myDayDate === todayStr()) {
    push(
      <React.Fragment key="myday">
        <Ionicons name="sunny-outline" size={12} color={colors.textSecondary} />
        <Text style={styles.metaText}> My Day</Text>
      </React.Fragment>
    );
  }
  if (task.dueDate) {
    const overdue = !task.completed && isOverdue(task.dueDate);
    const due = task.dueDate === todayStr();
    const color = overdue ? colors.danger : due ? accentColor : colors.textSecondary;
    push(
      <React.Fragment key="due">
        <Ionicons name="calendar-outline" size={12} color={color} />
        <Text style={[styles.metaText, { color }]}> {formatDueDate(task.dueDate)}</Text>
      </React.Fragment>
    );
  }
  if (task.repeat) {
    push(<Ionicons key="repeat" name="repeat" size={13} color={colors.textSecondary} />);
  }
  if (task.steps.length > 0) {
    const done = task.steps.filter((s) => s.completed).length;
    push(
      <Text key="steps" style={styles.metaText}>
        {done} of {task.steps.length}
      </Text>
    );
  }
  if (task.notes.trim().length > 0) {
    push(
      <Ionicons key="note" name="document-text-outline" size={12} color={colors.textSecondary} />
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <TaskCheckbox checked={task.completed} color={accentColor} onToggle={onToggle} />
      <View style={styles.body}>
        <Text
          style={[styles.title, task.completed && styles.titleCompleted]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        {meta.length > 0 && <View style={styles.metaRow}>{meta}</View>}
      </View>
      <Pressable hitSlop={10} onPress={onToggleImportant} style={styles.star}>
        <Ionicons
          name={task.important ? 'star' : 'star-outline'}
          size={20}
          color={task.important ? accentColor : colors.textTertiary}
        />
      </Pressable>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 3,
  },
  cardPressed: {
    backgroundColor: colors.pressed,
  },
  body: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    color: colors.text,
  },
  titleCompleted: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 3,
  },
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  metaDot: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  star: {
    padding: 2,
  },
});
