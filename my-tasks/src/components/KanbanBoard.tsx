import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { blockerOf, sortByOrder, useAppStore } from '../data/store';
import { ThemeColors, useThemedStyles } from '../theme';
import type { Task, TaskList, TaskSection } from '../types';
import { formatDueDate, isOverdue, todayStr } from '../utils/dates';
import { showMessage } from '../utils/ui';
import { AddTaskBar, QuickAddPayload } from './AddTaskBar';
import { MoveToSectionSheet } from './MoveToSectionSheet';
import { TaskCheckbox } from './TaskCheckbox';

interface Props {
  list: TaskList;
  /** All tasks of this list. */
  tasks: Task[];
  accent: string;
  onOpenTask: (taskId: string) => void;
  onToggle: (task: Task) => void;
  onAdd: (payload: QuickAddPayload, sectionId: string | null) => void;
  onAddSection: () => void;
  onSectionMenu: (section: TaskSection) => void;
}

interface Column {
  id: string | null;
  name: string;
  section: TaskSection | null;
  tasks: Task[];
}

/** Kanban view: sections as columns over the same task data. */
export function KanbanBoard({
  list,
  tasks,
  accent,
  onOpenTask,
  onToggle,
  onAdd,
  onAddSection,
  onSectionMenu,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const allTasks = useAppStore((s) => s.tasks);
  const [moveTask, setMoveTask] = useState<Task | null>(null);

  const sections = [...(list.sections ?? [])].sort((a, b) => a.order - b.order);
  const sectionIds = new Set(sections.map((s) => s.id));
  const incomplete = tasks.filter((t) => !t.completed);

  const columns: Column[] = [
    {
      id: null,
      name: 'No section',
      section: null,
      tasks: sortByOrder(
        incomplete.filter((t) => t.sectionId == null || !sectionIds.has(t.sectionId))
      ),
    },
    ...sections.map((section) => ({
      id: section.id as string | null,
      name: section.name,
      section,
      tasks: sortByOrder(incomplete.filter((t) => t.sectionId === section.id)),
    })),
  ];

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}>
        {columns.map((column) => (
          <View key={column.id ?? 'none'} style={styles.column}>
            <View style={styles.columnHeader}>
              <Text style={styles.columnTitle} numberOfLines={1}>
                {column.name}
              </Text>
              <Text style={styles.columnCount}>{column.tasks.length}</Text>
              {column.section && (
                <Pressable hitSlop={8} onPress={() => onSectionMenu(column.section as TaskSection)}>
                  <Ionicons name="ellipsis-horizontal" size={16} color={colors.textSecondary} />
                </Pressable>
              )}
            </View>
            <ScrollView style={styles.cards} showsVerticalScrollIndicator={false}>
              {column.tasks.map((task) => {
                const blocker = blockerOf(task, allTasks);
                return (
                  <Pressable
                    key={task.id}
                    style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                    onPress={() => onOpenTask(task.id)}
                  >
                    <View style={styles.cardTop}>
                      <TaskCheckbox
                        checked={task.completed}
                        color={accent}
                        size={18}
                        locked={blocker != null}
                        onToggle={() => {
                          if (blocker) {
                            showMessage('Task is blocked', `Finish "${blocker.title}" first.`);
                          } else {
                            onToggle(task);
                          }
                        }}
                      />
                      <Text style={styles.cardTitle} numberOfLines={3}>
                        {task.title}
                      </Text>
                      <Pressable hitSlop={8} onPress={() => setMoveTask(task)}>
                        <Ionicons
                          name="swap-horizontal-outline"
                          size={16}
                          color={colors.textTertiary}
                        />
                      </Pressable>
                    </View>
                    {(task.dueDate || task.steps.length > 0 || task.important) && (
                      <View style={styles.cardMeta}>
                        {task.important && <Ionicons name="star" size={12} color={accent} />}
                        {task.dueDate && (
                          <Text
                            style={[
                              styles.cardMetaText,
                              isOverdue(task.dueDate)
                                ? { color: colors.danger }
                                : task.dueDate === todayStr() && { color: accent },
                            ]}
                          >
                            {formatDueDate(task.dueDate)}
                          </Text>
                        )}
                        {task.steps.length > 0 && (
                          <Text style={styles.cardMetaText}>
                            {task.steps.filter((s) => s.completed).length}/{task.steps.length}
                          </Text>
                        )}
                      </View>
                    )}
                  </Pressable>
                );
              })}
              <AddTaskBar
                accentColor={accent}
                placeholder="Add a task"
                onAdd={(payload) => onAdd(payload, column.id)}
                style={styles.columnAdd}
              />
            </ScrollView>
          </View>
        ))}

        <Pressable style={styles.addColumn} onPress={onAddSection}>
          <Ionicons name="add" size={18} color={colors.textSecondary} />
          <Text style={styles.addColumnText}>Add section</Text>
        </Pressable>
      </ScrollView>

      {moveTask && (
        <MoveToSectionSheet
          visible={moveTask != null}
          onClose={() => setMoveTask(null)}
          list={list}
          task={moveTask}
        />
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    scroll: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      gap: 12,
    },
    column: {
      width: 272,
      borderRadius: 10,
      backgroundColor: colors.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.045)',
      padding: 10,
      maxHeight: '100%',
    },
    columnHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 4,
      paddingBottom: 8,
    },
    columnTitle: {
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    columnCount: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    cards: {
      flexGrow: 0,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
      boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.12)',
    },
    cardPressed: {
      backgroundColor: colors.pressed,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    cardTitle: {
      flex: 1,
      fontSize: 13,
      color: colors.text,
      lineHeight: 18,
    },
    cardMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 6,
      marginLeft: 26,
    },
    cardMetaText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    columnAdd: {
      marginTop: 2,
    },
    addColumn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    addColumnText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
  });
