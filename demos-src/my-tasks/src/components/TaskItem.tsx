import { Ionicons } from '@expo/vector-icons';
import React, { useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
  /** Waiting on another task: lock the checkbox (parent shows the message). */
  blocked?: boolean;
  /** Reorder handle (parent supplies gesture handlers). */
  dragHandle?: React.ReactNode;
  onPress: () => void;
  onToggle: () => void;
  onToggleImportant: () => void;
}

export function TaskItem({
  task,
  accentColor,
  listName,
  hideMyDayBadge,
  blocked,
  dragHandle,
  onPress,
  onToggle,
  onToggleImportant,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);

  // Completing gets a little ceremony: the checkbox pops and the card fades
  // for a beat before the task re-sorts into Completed.
  const checkScale = useRef(new Animated.Value(1)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const completing = useRef(false);
  const native = Platform.OS !== 'web';

  const handleToggle = () => {
    if (completing.current) return;
    if (task.completed) {
      onToggle();
      return;
    }
    completing.current = true;
    Animated.sequence([
      Animated.timing(checkScale, { toValue: 1.3, duration: 110, useNativeDriver: native }),
      Animated.timing(checkScale, { toValue: 1, duration: 110, useNativeDriver: native }),
    ]).start();
    Animated.timing(cardOpacity, {
      toValue: 0.35,
      duration: 200,
      delay: 90,
      useNativeDriver: native,
    }).start(() => {
      completing.current = false;
      cardOpacity.setValue(1);
      checkScale.setValue(1);
      onToggle();
    });
  };

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

  if (blocked) {
    push(
      <React.Fragment key="blocked">
        <Ionicons name="lock-closed" size={11} color={colors.textSecondary} />
        <Text style={styles.metaText}> Blocked</Text>
      </React.Fragment>
    );
  }
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
    <Animated.View style={{ opacity: cardOpacity }}>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={onPress}
      >
        <Animated.View style={{ transform: [{ scale: checkScale }] }}>
          <TaskCheckbox
            checked={task.completed}
            color={accentColor}
            onToggle={handleToggle}
            locked={blocked}
          />
        </Animated.View>
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
      {dragHandle}
      </Pressable>
    </Animated.View>
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
