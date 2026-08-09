import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { IconName } from '../constants';
import { MY_DAY_SOFT_LIMIT } from '../constants';
import { api, toggleTaskCompleted } from '../data/api';
import { blockerOf, myDayIncompleteCount, useAppStore } from '../data/store';
import type { Task, TaskStep } from '../types';
import { ThemeColors, useThemedStyles } from '../theme';
import {
  formatDueDate,
  formatTimestamp,
  isOverdue,
  repeatLabel,
  todayStr,
} from '../utils/dates';
import { genId } from '../utils/id';
import { confirmDialog, showMessage } from '../utils/ui';
import { AssignSheet } from './AssignSheet';
import { BlockerSheet } from './BlockerSheet';
import { DueDateSheet } from './DueDateSheet';
import { MoveToSectionSheet } from './MoveToSectionSheet';
import { RepeatSheet } from './RepeatSheet';
import { TaskCheckbox } from './TaskCheckbox';

interface Props {
  taskId: string;
  /** Also called when the task no longer exists (deleted, possibly remotely). */
  onClose: () => void;
  /** chevron-back when the pane is a pushed screen, chevron-forward when it's a side panel. */
  dismissIcon?: IconName;
}

function reportError(e: unknown) {
  showMessage('Could not update task', e instanceof Error ? e.message : String(e));
}

interface StepRowProps {
  step: TaskStep;
  accent: string;
  /** Lockstep mode: previous steps must be completed first. */
  locked?: boolean;
  onToggle: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}

function StepRow({ step, accent, locked, onToggle, onRename, onRemove }: StepRowProps) {
  const { colors, styles } = useThemedStyles(createStyles);
  const [text, setText] = useState(step.title);

  useEffect(() => {
    setText(step.title);
  }, [step.title]);

  const commit = () => {
    const title = text.trim();
    if (!title) onRemove();
    else if (title !== step.title) onRename(title);
  };

  return (
    <View style={[styles.stepRow, locked && styles.stepLocked]}>
      <TaskCheckbox
        checked={step.completed}
        color={accent}
        locked={locked}
        onToggle={() => {
          if (locked) {
            showMessage('Steps go in order', 'Finish the previous step first.');
            return;
          }
          onToggle();
        }}
        size={18}
      />
      <TextInput
        style={[styles.stepInput, step.completed && styles.stepCompleted]}
        value={text}
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
      />
      <Pressable hitSlop={8} onPress={onRemove}>
        <Ionicons name="close" size={18} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

export function TaskDetailPane({ taskId, onClose, dismissIcon = 'chevron-back' }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const task = useAppStore((s) => s.tasks.find((t) => t.id === taskId));
  const lists = useAppStore((s) => s.lists);
  const allTasks = useAppStore((s) => s.tasks);
  const mode = useAppStore((s) => s.mode);
  const members = useAppStore((s) => s.members);

  const list = task ? lists.find((l) => l.id === task.listId) : undefined;
  const accent = list?.color ?? colors.primary;

  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [newStep, setNewStep] = useState('');
  const [dueOpen, setDueOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [blockerOpen, setBlockerOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);

  useEffect(() => {
    if (!task) onClose();
  }, [task, onClose]);

  useEffect(() => {
    setTitle(task?.title ?? '');
  }, [task?.title]);

  useEffect(() => {
    setNotes(task?.notes ?? '');
  }, [task?.notes]);

  if (!task) return null;

  const update = (patch: Partial<Task>) => {
    api.updateTask(task.id, patch).catch(reportError);
  };

  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== task.title) update({ title: t });
    else setTitle(task.title);
  };

  const saveNotes = () => {
    if (notes !== task.notes) update({ notes });
  };

  const updateSteps = (steps: TaskStep[]) => update({ steps });

  const addStep = () => {
    const t = newStep.trim();
    if (!t) return;
    updateSteps([...task.steps, { id: genId(), title: t, completed: false }]);
    setNewStep('');
  };

  const inMyDay = task.myDayDate === todayStr();
  const toggleMyDay = () => {
    if (inMyDay) {
      update({ myDayDate: null });
      return;
    }
    const add = () => update({ myDayDate: todayStr(), someday: false });
    const staged = myDayIncompleteCount(useAppStore.getState().tasks);
    if (staged >= MY_DAY_SOFT_LIMIT) {
      confirmDialog(
        'My Day is full',
        `You already have ${MY_DAY_SOFT_LIMIT} tasks staged for today. Consider finishing or parking one in Someday first.`,
        'Add anyway',
        add,
        false
      );
    } else {
      add();
    }
  };

  const toggleSomeday = () => {
    if (task.someday) update({ someday: false });
    else update({ someday: true, myDayDate: null, dueDate: null });
  };

  const dueColor = task.dueDate
    ? !task.completed && isOverdue(task.dueDate)
      ? colors.danger
      : accent
    : colors.textSecondary;

  const assignee = task.assigneeId ? members[task.assigneeId] : undefined;
  const canAssign = mode === 'cloud' && (list?.memberIds.length ?? 0) > 1;

  const blocker = blockerOf(task, allTasks);
  const blockerCandidates = allTasks.some(
    (t) => t.listId === task.listId && t.id !== task.id && !t.completed
  );
  const sections = [...(list?.sections ?? [])].sort((a, b) => a.order - b.order);
  const currentSection = sections.find((s) => s.id === task.sectionId);
  const firstIncompleteStep = task.steps.findIndex((s) => !s.completed);

  const handleDelete = () => {
    confirmDialog(
      'Delete task',
      `"${task.title}" will be permanently deleted.`,
      'Delete',
      async () => {
        try {
          await api.deleteTask(task.id);
        } catch (e) {
          reportError(e);
        }
      }
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={[styles.topTitle, { color: accent }]} numberOfLines={1}>
          {list?.name ?? ''}
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={styles.titleRow}>
              <TaskCheckbox
                checked={task.completed}
                color={accent}
                locked={blocker != null && !task.completed}
                onToggle={() => {
                  if (blocker && !task.completed) {
                    showMessage('Task is blocked', `Finish "${blocker.title}" first.`);
                    return;
                  }
                  toggleTaskCompleted(task).catch(reportError);
                }}
              />
              <TextInput
                style={[styles.titleInput, task.completed && styles.titleCompleted]}
                value={title}
                onChangeText={setTitle}
                onBlur={saveTitle}
                onSubmitEditing={saveTitle}
                multiline
              />
              <Pressable
                hitSlop={10}
                onPress={() => update({ important: !task.important })}
              >
                <Ionicons
                  name={task.important ? 'star' : 'star-outline'}
                  size={22}
                  color={task.important ? accent : colors.textTertiary}
                />
              </Pressable>
            </View>

            {task.steps.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
                accent={accent}
                locked={
                  task.stepsInOrder === true &&
                  !step.completed &&
                  firstIncompleteStep !== -1 &&
                  index > firstIncompleteStep
                }
                onToggle={() =>
                  updateSteps(
                    task.steps.map((s) =>
                      s.id === step.id ? { ...s, completed: !s.completed } : s
                    )
                  )
                }
                onRename={(t) =>
                  updateSteps(
                    task.steps.map((s) => (s.id === step.id ? { ...s, title: t } : s))
                  )
                }
                onRemove={() => updateSteps(task.steps.filter((s) => s.id !== step.id))}
              />
            ))}

            <View style={styles.stepRow}>
              <Ionicons name="add" size={20} color={accent} />
              <TextInput
                style={styles.stepInput}
                value={newStep}
                onChangeText={setNewStep}
                placeholder={task.steps.length > 0 ? 'Next step' : 'Add step'}
                placeholderTextColor={accent}
                onSubmitEditing={addStep}
                submitBehavior="submit"
                blurOnSubmit={false}
              />
            </View>
            {task.steps.length > 1 && (
              <Pressable
                style={[styles.stepRow, styles.lockstepRow]}
                onPress={() => update({ stepsInOrder: task.stepsInOrder !== true })}
              >
                <Ionicons
                  name={task.stepsInOrder ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={task.stepsInOrder ? accent : colors.textTertiary}
                />
                <Text
                  style={[styles.lockstepLabel, task.stepsInOrder === true && { color: accent }]}
                >
                  Complete steps in order
                </Text>
              </Pressable>
            )}
          </View>

          {list && sections.length > 0 && (
            <View style={styles.card}>
              <Pressable style={styles.optionRow} onPress={() => setSectionOpen(true)}>
                <Ionicons
                  name="folder-outline"
                  size={20}
                  color={currentSection ? accent : colors.textSecondary}
                />
                <Text style={[styles.optionLabel, currentSection != null && { color: accent }]}>
                  {currentSection ? currentSection.name : 'Add to section'}
                </Text>
              </Pressable>
            </View>
          )}

          {(blockerCandidates || task.blockedBy != null) && (
            <View style={styles.card}>
              <Pressable style={styles.optionRow} onPress={() => setBlockerOpen(true)}>
                <Ionicons
                  name={blocker ? 'lock-closed' : 'lock-closed-outline'}
                  size={20}
                  color={blocker ? colors.danger : colors.textSecondary}
                />
                <Text style={[styles.optionLabel, blocker != null && { color: colors.danger }]}>
                  {blocker ? `Blocked by "${blocker.title}"` : 'Blocked by…'}
                </Text>
                {task.blockedBy && (
                  <Pressable hitSlop={8} onPress={() => update({ blockedBy: null })}>
                    <Ionicons name="close" size={18} color={colors.textTertiary} />
                  </Pressable>
                )}
              </Pressable>
            </View>
          )}

          <View style={styles.card}>
            <Pressable style={styles.optionRow} onPress={toggleMyDay}>
              <Ionicons
                name="sunny-outline"
                size={20}
                color={inMyDay ? accent : colors.textSecondary}
              />
              <Text style={[styles.optionLabel, inMyDay && { color: accent }]}>
                {inMyDay ? 'Added to My Day' : 'Add to My Day'}
              </Text>
              {inMyDay && <Ionicons name="close" size={18} color={colors.textTertiary} />}
            </Pressable>
            <View style={styles.rowDivider} />
            <Pressable style={styles.optionRow} onPress={toggleSomeday}>
              <Ionicons
                name="file-tray-full-outline"
                size={20}
                color={task.someday ? accent : colors.textSecondary}
              />
              <Text style={[styles.optionLabel, task.someday && { color: accent }]}>
                {task.someday ? 'Parked in Someday' : 'Move to Someday'}
              </Text>
              {task.someday && <Ionicons name="close" size={18} color={colors.textTertiary} />}
            </Pressable>
          </View>

          <View style={styles.card}>
            <Pressable style={styles.optionRow} onPress={() => setDueOpen(true)}>
              <Ionicons name="calendar-outline" size={20} color={dueColor} />
              <Text style={[styles.optionLabel, { color: dueColor }]}>
                {task.dueDate ? `Due ${formatDueDate(task.dueDate)}` : 'Add due date'}
              </Text>
              {task.dueDate && (
                <Pressable hitSlop={8} onPress={() => update({ dueDate: null })}>
                  <Ionicons name="close" size={18} color={colors.textTertiary} />
                </Pressable>
              )}
            </Pressable>
            <View style={styles.rowDivider} />
            <Pressable style={styles.optionRow} onPress={() => setRepeatOpen(true)}>
              <Ionicons
                name="repeat"
                size={20}
                color={task.repeat ? accent : colors.textSecondary}
              />
              <Text style={[styles.optionLabel, task.repeat != null && { color: accent }]}>
                {task.repeat ? repeatLabel(task.repeat) : 'Repeat'}
              </Text>
              {task.repeat && (
                <Pressable hitSlop={8} onPress={() => update({ repeat: null })}>
                  <Ionicons name="close" size={18} color={colors.textTertiary} />
                </Pressable>
              )}
            </Pressable>
          </View>

          {canAssign && list && (
            <View style={styles.card}>
              <Pressable style={styles.optionRow} onPress={() => setAssignOpen(true)}>
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={assignee ? accent : colors.textSecondary}
                />
                <Text style={[styles.optionLabel, assignee != null && { color: accent }]}>
                  {assignee ? `Assigned to ${assignee.name}` : 'Assign to'}
                </Text>
                {task.assigneeId && (
                  <Pressable hitSlop={8} onPress={() => update({ assigneeId: null })}>
                    <Ionicons name="close" size={18} color={colors.textTertiary} />
                  </Pressable>
                )}
              </Pressable>
            </View>
          )}

          <View style={styles.card}>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              onBlur={saveNotes}
              placeholder="Add note"
              placeholderTextColor={colors.textSecondary}
              multiline
              textAlignVertical="top"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable hitSlop={10} onPress={onClose} style={styles.footerButton}>
          <Ionicons name={dismissIcon} size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.footerText}>Created {formatTimestamp(task.createdAt)}</Text>
        <Pressable hitSlop={10} onPress={handleDelete} style={styles.footerButton}>
          <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      <DueDateSheet
        visible={dueOpen}
        onClose={() => setDueOpen(false)}
        current={task.dueDate}
        onSelect={(date) => update({ dueDate: date })}
      />
      <RepeatSheet
        visible={repeatOpen}
        onClose={() => setRepeatOpen(false)}
        current={task.repeat}
        referenceDate={task.dueDate}
        onSelect={(repeat) => {
          // A repeating task needs a due date to schedule from.
          const patch: Partial<Task> = { repeat };
          if (repeat && !task.dueDate) patch.dueDate = todayStr();
          update(patch);
        }}
      />
      {list && (
        <AssignSheet
          visible={assignOpen}
          onClose={() => setAssignOpen(false)}
          list={list}
          currentAssigneeId={task.assigneeId}
          onSelect={(assigneeId) => update({ assigneeId })}
        />
      )}
      {list && (
        <MoveToSectionSheet
          visible={sectionOpen}
          onClose={() => setSectionOpen(false)}
          list={list}
          task={task}
        />
      )}
      <BlockerSheet visible={blockerOpen} onClose={() => setBlockerOpen(false)} task={task} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  topTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  titleInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginHorizontal: 12,
    paddingVertical: 0,
  },
  titleCompleted: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stepInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    marginHorizontal: 12,
    paddingVertical: 2,
  },
  stepCompleted: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  stepLocked: {
    opacity: 0.55,
  },
  lockstepRow: {
    alignItems: 'center',
  },
  lockstepLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  optionLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    marginLeft: 12,
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  notesInput: {
    fontSize: 14,
    color: colors.text,
    minHeight: 90,
    paddingVertical: 10,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  footerButton: {
    padding: 6,
  },
  footerText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textSecondary,
  },
});
