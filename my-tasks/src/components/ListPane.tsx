import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  ImageBackground,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { backgroundSource } from '../backgrounds';
import type { IconName } from '../constants';
import { MY_DAY_SOFT_LIMIT, SMART_LISTS, smartColor } from '../constants';
import { api, toggleTaskCompleted } from '../data/api';
import type { TaskDraft } from '../data/service';
import {
  blockerOf,
  effectiveOrder,
  getDefaultList,
  myDayIncompleteCount,
  sortByOrder,
  tasksForSmartList,
  useAppStore,
} from '../data/store';
import type { SmartListId, Task, TaskSection } from '../types';
import {
  setListViewMode,
  setSmartBackground,
  ThemeColors,
  useThemedStyles,
  useThemeStore,
} from '../theme';
import { addDaysStr, formatLongDate, todayStr } from '../utils/dates';
import { genId } from '../utils/id';
import { confirmDialog, showMessage } from '../utils/ui';
import { AddTaskBar, QuickAddPayload } from './AddTaskBar';
import { Avatar } from './Avatar';
import { BackgroundSheet } from './BackgroundSheet';
import { ChatSheet } from './ChatSheet';
import { KanbanBoard } from './KanbanBoard';
import { ListEditorModal } from './ListEditorModal';
import { PromptSheet } from './PromptSheet';
import { ShareSheet } from './ShareSheet';
import { Sheet, SheetItem } from './Sheet';
import { TaskItem } from './TaskItem';

interface Props {
  listId?: string;
  smart?: SmartListId;
  onOpenTask: (taskId: string) => void;
  /** When set, a back button is shown at the bottom-left, next to "Add a task". */
  onBack?: () => void;
  /** Called when the list no longer exists (deleted / left, possibly remotely). */
  onMissing: () => void;
}

type Row =
  | { kind: 'task'; key: string; task: Task }
  | { kind: 'sectionHeader'; key: string; section: TaskSection }
  | { kind: 'section'; key: string; title: string; count?: number; collapsible?: boolean }
  | { kind: 'dropSlot'; key: string };

/** A place a dragged task can land. */
interface DropSlot {
  insertAt: number;
  sectionId: string | null;
  prevKey: string | null;
  nextKey: string | null;
  y: number;
}

function plannedGroups(tasks: Task[]): { title: string; tasks: Task[] }[] {
  const today = todayStr();
  const tomorrow = addDaysStr(today, 1);
  const groups = [
    { title: 'Overdue', tasks: [] as Task[] },
    { title: 'Today', tasks: [] as Task[] },
    { title: 'Tomorrow', tasks: [] as Task[] },
    { title: 'Later', tasks: [] as Task[] },
  ];
  const sorted = [...tasks].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  for (const t of sorted) {
    const due = t.dueDate ?? '';
    if (due < today) groups[0].tasks.push(t);
    else if (due === today) groups[1].tasks.push(t);
    else if (due === tomorrow) groups[2].tasks.push(t);
    else groups[3].tasks.push(t);
  }
  return groups.filter((g) => g.tasks.length > 0);
}

const EMPTY_STATES: Record<string, { icon: IconName; title: string; hint: string }> = {
  myday: {
    icon: 'sunny-outline',
    title: 'Focus on your day',
    hint: 'Add tasks to My Day to plan what you want to get done today.',
  },
  important: {
    icon: 'star-outline',
    title: 'No important tasks',
    hint: 'Star a task and it will show up here.',
  },
  planned: {
    icon: 'calendar-outline',
    title: 'Nothing planned',
    hint: 'Tasks with due dates show up here.',
  },
  assigned: {
    icon: 'person-outline',
    title: 'Nothing assigned to you',
    hint: 'Tasks that friends assign to you in shared lists show up here.',
  },
  someday: {
    icon: 'file-tray-full-outline',
    title: 'Nothing parked here',
    hint: 'Send ideas and low-priority tasks here — out of your way, never lost.',
  },
  list: {
    icon: 'clipboard-outline',
    title: 'No tasks yet',
    hint: 'Add a task below to get started.',
  },
};

export function ListPane({ listId, smart, onOpenTask, onBack, onMissing }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const user = useAppStore((s) => s.user);
  const mode = useAppStore((s) => s.mode);
  const members = useAppStore((s) => s.members);

  const [showCompleted, setShowCompleted] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [sectionPrompt, setSectionPrompt] = useState<
    null | { kind: 'add' } | { kind: 'rename'; section: TaskSection }
  >(null);
  const [sectionMenu, setSectionMenu] = useState<TaskSection | null>(null);

  const list = listId ? lists.find((l) => l.id === listId) : undefined;
  const smartMeta = smart ? SMART_LISTS[smart] : undefined;

  useEffect(() => {
    if (!smart && !list) onMissing();
  }, [smart, list, onMissing]);

  const accent = smartMeta
    ? smartColor(smartMeta, colors.dark)
    : list?.color ?? colors.primary;
  const title = smartMeta?.name ?? list?.name ?? '';

  const smartBackgrounds = useThemeStore((s) => s.smartBackgrounds);
  const listViewModes = useThemeStore((s) => s.listViewModes);
  const viewMode = list ? listViewModes[list.id] ?? 'list' : 'list';
  const isBoard = list != null && viewMode === 'board';

  const backgroundId = list ? list.background ?? null : smart ? smartBackgrounds[smart] ?? null : null;
  const bgSource = backgroundSource(backgroundId);
  const onPhoto = bgSource != null;
  const iconColor = onPhoto ? '#FFFFFF' : accent;

  const handlePickBackground = (background: string | null) => {
    if (smart) setSmartBackground(smart, background);
    else if (list) {
      api
        .updateList(list.id, { background })
        .catch((e) =>
          showMessage('Could not update list', e instanceof Error ? e.message : String(e))
        );
    }
  };
  const isOwner = !list || list.ownerId === user?.id;
  const isShared = (list?.memberIds.length ?? 0) > 1;

  const relevantTasks = useMemo(() => {
    if (smart) return tasksForSmartList(tasks, smart, user?.id);
    return tasks.filter((t) => t.listId === listId);
  }, [tasks, smart, listId, user?.id]);

  const rows = useMemo<Row[]>(() => {
    const completed = relevantTasks
      .filter((t) => t.completed)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

    const result: Row[] = [];
    if (smart === 'planned') {
      const incomplete = relevantTasks
        .filter((t) => !t.completed)
        .sort((a, b) => b.createdAt - a.createdAt);
      for (const group of plannedGroups(incomplete)) {
        result.push({ kind: 'section', key: `s:${group.title}`, title: group.title });
        for (const t of group.tasks) result.push({ kind: 'task', key: t.id, task: t });
      }
    } else if (!smart && list) {
      // Real list: manual order, grouped into sections (unsectioned first).
      const incomplete = sortByOrder(relevantTasks.filter((t) => !t.completed));
      const sections = [...(list.sections ?? [])].sort((a, b) => a.order - b.order);
      const sectionIds = new Set(sections.map((s) => s.id));
      for (const t of incomplete) {
        if (t.sectionId == null || !sectionIds.has(t.sectionId)) {
          result.push({ kind: 'task', key: t.id, task: t });
        }
      }
      for (const section of sections) {
        result.push({ kind: 'sectionHeader', key: `sh:${section.id}`, section });
        for (const t of incomplete) {
          if (t.sectionId === section.id) result.push({ kind: 'task', key: t.id, task: t });
        }
      }
    } else {
      const incomplete = relevantTasks
        .filter((t) => !t.completed)
        .sort((a, b) => b.createdAt - a.createdAt);
      for (const t of incomplete) result.push({ kind: 'task', key: t.id, task: t });
    }
    if (completed.length > 0) {
      result.push({
        kind: 'section',
        key: 's:completed',
        title: 'Completed',
        count: completed.length,
        collapsible: true,
      });
      if (showCompleted) {
        for (const t of completed) result.push({ kind: 'task', key: t.id, task: t });
      }
    }
    return result;
  }, [relevantTasks, smart, list, showCompleted]);

  // --- Drag to reorder / move between sections (real-list checklist view) ---

  const [drag, setDrag] = useState<{
    taskId: string;
    slots: DropSlot[];
    slotIdx: number | null;
  } | null>(null);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const rowEls = useRef(new Map<string, View | null>());
  const respondersRef = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());
  const dragApiRef = useRef({
    begin: (_taskId: string) => {},
    move: (_y: number) => {},
    end: (_commit: boolean) => {},
  });

  dragApiRef.current = {
    begin: (taskId: string) => {
      const current = rowsRef.current;
      const completedIdx = current.findIndex((r) => r.key === 's:completed');
      const endIdx = completedIdx === -1 ? current.length : completedIdx;
      const region = current.slice(0, endIdx);

      const measure = (key: string) =>
        new Promise<{ key: string; y: number; h: number } | null>((resolve) => {
          const el = rowEls.current.get(key);
          if (!el) {
            resolve(null);
            return;
          }
          el.measureInWindow((_x, y, _w, h) => resolve({ key, y, h }));
        });

      Promise.all(region.map((r) => measure(r.key))).then((measures) => {
        const byKey = new Map(measures.filter(Boolean).map((m) => [(m as { key: string }).key, m as { y: number; h: number }]));
        const slots: DropSlot[] = [];
        let currentSection: string | null = null;
        let prevKey: string | null = null;
        let lastBottom: number | null = null;

        region.forEach((row, i) => {
          const m = byKey.get(row.key);
          if (row.kind === 'sectionHeader') {
            if (m) slots.push({ insertAt: i, sectionId: currentSection, prevKey, nextKey: null, y: m.y });
            currentSection = row.section.id;
            prevKey = null;
            if (m) lastBottom = m.y + m.h;
            return;
          }
          if (row.kind !== 'task') return;
          if (m) {
            slots.push({ insertAt: i, sectionId: currentSection, prevKey, nextKey: row.key, y: m.y });
            lastBottom = m.y + m.h;
          }
          prevKey = row.key;
        });
        if (lastBottom != null) {
          slots.push({ insertAt: endIdx, sectionId: currentSection, prevKey, nextKey: null, y: lastBottom });
        }
        setDrag({ taskId, slots, slotIdx: null });
      });
    },
    move: (y: number) => {
      const d = dragRef.current;
      if (!d || d.slots.length === 0) return;
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      d.slots.forEach((slot, i) => {
        const dist = Math.abs(y - slot.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      if (best !== d.slotIdx) setDrag({ ...d, slotIdx: best });
    },
    end: (commit: boolean) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || !commit || d.slotIdx == null) return;
      const slot = d.slots[d.slotIdx];
      // Dropping right where it started is a no-op.
      if (slot.prevKey === d.taskId || slot.nextKey === d.taskId) return;
      const all = tasksRef.current;
      const prev = slot.prevKey ? all.find((t) => t.id === slot.prevKey) : undefined;
      const next = slot.nextKey ? all.find((t) => t.id === slot.nextKey) : undefined;
      let order: number;
      if (prev && next) order = (effectiveOrder(prev) + effectiveOrder(next)) / 2;
      else if (next) order = effectiveOrder(next) - 1;
      else if (prev) order = effectiveOrder(prev) + 1;
      else order = -Date.now();
      api
        .updateTask(d.taskId, { sectionId: slot.sectionId, order })
        .catch((e) =>
          showMessage('Could not move task', e instanceof Error ? e.message : String(e))
        );
    },
  };

  const getPanHandlers = (taskId: string) => {
    let responder = respondersRef.current.get(taskId);
    if (!responder) {
      responder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => dragApiRef.current.begin(taskId),
        onPanResponderMove: (_e, g) => dragApiRef.current.move(g.moveY),
        onPanResponderRelease: () => dragApiRef.current.end(true),
        onPanResponderTerminate: () => dragApiRef.current.end(false),
        onPanResponderTerminationRequest: () => false,
      });
      respondersRef.current.set(taskId, responder);
    }
    return responder.panHandlers;
  };

  const showHandles = !smart && list != null && !isBoard;

  const displayRows = useMemo<Row[]>(() => {
    if (!drag || drag.slotIdx == null) return rows;
    const slot = drag.slots[drag.slotIdx];
    const marker: Row = { kind: 'dropSlot', key: '__drop__' };
    return [...rows.slice(0, slot.insertAt), marker, ...rows.slice(slot.insertAt)];
  }, [rows, drag]);

  // --- Sections CRUD -------------------------------------------------------

  const saveSections = (sections: TaskSection[]) => {
    if (!list) return;
    api
      .updateList(list.id, { sections })
      .catch((e) =>
        showMessage('Could not update sections', e instanceof Error ? e.message : String(e))
      );
  };

  const addSection = (name: string) => {
    const existing = list?.sections ?? [];
    const maxOrder = existing.reduce((m, s) => Math.max(m, s.order), 0);
    saveSections([...existing, { id: genId(), name, order: maxOrder + 1 }]);
  };

  const renameSection = (section: TaskSection, name: string) => {
    saveSections((list?.sections ?? []).map((s) => (s.id === section.id ? { ...s, name } : s)));
  };

  const deleteSection = (section: TaskSection) => {
    confirmDialog(
      'Delete section',
      `Tasks in "${section.name}" move out of the section (they are not deleted).`,
      'Delete',
      () => saveSections((list?.sections ?? []).filter((s) => s.id !== section.id))
    );
  };

  // --- Task actions --------------------------------------------------------

  const listNameOf = (id: string) => lists.find((l) => l.id === id)?.name;

  const guardedToggle = (task: Task) => {
    const blocker = blockerOf(task, tasks);
    if (blocker && !task.completed) {
      showMessage('Task is blocked', `Finish "${blocker.title}" first.`);
      return;
    }
    toggleTaskCompleted(task).catch((e) =>
      showMessage('Could not update task', e instanceof Error ? e.message : String(e))
    );
  };

  const handleAdd = (payload: QuickAddPayload, sectionId: string | null = null) => {
    const targetListId = listId ?? getDefaultList(lists, user?.id)?.id;
    if (!targetListId) return;
    const draft: TaskDraft = {
      listId: targetListId,
      title: payload.title,
      dueDate: payload.dueDate,
      important: payload.important || smart === 'important',
      sectionId,
    };
    if (smart === 'myday') draft.myDayDate = todayStr();
    if (smart === 'planned' && !draft.dueDate) draft.dueDate = todayStr();
    if (smart === 'someday') draft.someday = true;

    const create = () =>
      api
        .createTask(draft)
        .catch((e) =>
          showMessage('Could not add task', e instanceof Error ? e.message : String(e))
        );

    // The Stage stays small: My Day nudges before a 6th commitment.
    if (smart === 'myday' && myDayIncompleteCount(tasks) >= MY_DAY_SOFT_LIMIT) {
      confirmDialog(
        'My Day is full',
        `You already have ${MY_DAY_SOFT_LIMIT} tasks staged for today. Consider finishing or parking one in Someday first.`,
        'Add anyway',
        create,
        false
      );
      return;
    }
    create();
  };

  const handleShare = () => {
    setMenuOpen(false);
    if (mode !== 'cloud') {
      showMessage(
        'Sharing needs cloud sync',
        'Add your Firebase config to firebase.config.ts (see README.md) to share lists with friends.'
      );
      return;
    }
    setShareOpen(true);
  };

  const handleDelete = () => {
    if (!list) return;
    setMenuOpen(false);
    confirmDialog(
      'Delete list',
      `"${list.name}" and all of its tasks will be permanently deleted.`,
      'Delete',
      async () => {
        try {
          await api.deleteList(list.id);
        } catch (e) {
          showMessage('Could not delete list', e instanceof Error ? e.message : String(e));
        }
      }
    );
  };

  const handleLeave = () => {
    if (!list) return;
    setMenuOpen(false);
    confirmDialog(
      'Leave list',
      `You will lose access to "${list.name}" until someone invites you again.`,
      'Leave',
      async () => {
        try {
          await api.leaveList(list.id);
        } catch (e) {
          showMessage('Could not leave list', e instanceof Error ? e.message : String(e));
        }
      }
    );
  };

  const emptyState = EMPTY_STATES[smart ?? 'list'];
  const showAddBar = smart !== 'assigned' && !isBoard;

  return (
    <View style={styles.container}>
      {bgSource && (
        <ImageBackground source={bgSource} style={StyleSheet.absoluteFill} resizeMode="cover">
          <View style={[StyleSheet.absoluteFill, styles.scrim]} />
        </ImageBackground>
      )}
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text
            style={[styles.title, { color: accent }, onPhoto && styles.textOnPhoto]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {smart === 'myday' && (
            <Text style={[styles.subtitle, onPhoto && styles.dimTextOnPhoto]}>
              {formatLongDate(new Date())}
            </Text>
          )}
          {list && isShared && (
            <Pressable style={styles.membersRow} onPress={handleShare}>
              {list.memberIds.slice(0, 5).map((id, i) => (
                <View key={id} style={i > 0 ? styles.memberOverlap : undefined}>
                  <Avatar id={id} name={members[id]?.name ?? '?'} size={24} />
                </View>
              ))}
              <Text style={[styles.membersLabel, onPhoto && styles.dimTextOnPhoto]}>
                {list.memberIds.length} members
              </Text>
            </Pressable>
          )}
        </View>
        {smart && (
          <Pressable hitSlop={10} onPress={() => setBgOpen(true)} style={styles.topIcon}>
            <Ionicons name="color-palette-outline" size={22} color={iconColor} />
          </Pressable>
        )}
        {list && (
          <Pressable
            hitSlop={10}
            onPress={() => setListViewMode(list.id, isBoard ? 'list' : 'board')}
            style={styles.topIcon}
          >
            <Ionicons name={isBoard ? 'list-outline' : 'grid-outline'} size={22} color={iconColor} />
          </Pressable>
        )}
        {list && isShared && mode === 'cloud' && (
          <Pressable hitSlop={10} onPress={() => setChatOpen(true)} style={styles.topIcon}>
            <Ionicons name="chatbubbles-outline" size={22} color={iconColor} />
          </Pressable>
        )}
        {list && !list.isDefault && mode === 'cloud' && (
          <Pressable hitSlop={10} onPress={handleShare} style={styles.topIcon}>
            <Ionicons name="person-add-outline" size={22} color={iconColor} />
          </Pressable>
        )}
        {list && (
          <Pressable hitSlop={10} onPress={() => setMenuOpen(true)} style={styles.topIcon}>
            <Ionicons name="ellipsis-horizontal" size={22} color={iconColor} />
          </Pressable>
        )}
      </View>

      {isBoard && list ? (
        <KanbanBoard
          list={list}
          tasks={relevantTasks}
          accent={accent}
          onOpenTask={onOpenTask}
          onToggle={guardedToggle}
          onAdd={handleAdd}
          onAddSection={() => setSectionPrompt({ kind: 'add' })}
          onSectionMenu={(section) => setSectionMenu(section)}
        />
      ) : (
        <FlatList
          data={displayRows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={drag == null}
          renderItem={({ item }) => {
            if (item.kind === 'dropSlot') {
              return <View style={[styles.dropSlot, { backgroundColor: accent }]} />;
            }
            if (item.kind === 'sectionHeader') {
              return (
                <View
                  ref={(el) => {
                    rowEls.current.set(item.key, el);
                  }}
                  collapsable={false}
                  style={styles.sectionHeaderRow}
                >
                  <Text style={[styles.sectionTitle, styles.sectionName, onPhoto && styles.dimTextOnPhoto]}>
                    {item.section.name}
                  </Text>
                  <Pressable hitSlop={8} onPress={() => setSectionMenu(item.section)}>
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={16}
                      color={onPhoto ? '#FFFFFF' : colors.textSecondary}
                    />
                  </Pressable>
                </View>
              );
            }
            if (item.kind === 'section') {
              if (item.collapsible) {
                return (
                  <Pressable
                    style={styles.completedHeader}
                    onPress={() => setShowCompleted((v) => !v)}
                  >
                    <Ionicons
                      name={showCompleted ? 'chevron-down' : 'chevron-forward'}
                      size={16}
                      color={colors.textSecondary}
                    />
                    <Text style={[styles.completedTitle, onPhoto && styles.dimTextOnPhoto]}>
                      {item.title} {item.count}
                    </Text>
                  </Pressable>
                );
              }
              return (
                <Text style={[styles.sectionTitle, onPhoto && styles.dimTextOnPhoto]}>
                  {item.title}
                </Text>
              );
            }
            const task = item.task;
            const blocker = blockerOf(task, tasks);
            return (
              <View
                ref={(el) => {
                  rowEls.current.set(item.key, el);
                }}
                collapsable={false}
                style={drag?.taskId === task.id ? styles.draggingRow : undefined}
              >
                <TaskItem
                  task={task}
                  accentColor={accent}
                  listName={smart ? listNameOf(task.listId) : undefined}
                  hideMyDayBadge={smart === 'myday'}
                  blocked={blocker != null && !task.completed}
                  dragHandle={
                    showHandles && !task.completed ? (
                      <View style={styles.dragHandle} {...getPanHandlers(task.id)}>
                        <Ionicons name="reorder-two-outline" size={20} color={colors.textTertiary} />
                      </View>
                    ) : undefined
                  }
                  onPress={() => onOpenTask(task.id)}
                  onToggle={() => guardedToggle(task)}
                  onToggleImportant={() =>
                    api
                      .updateTask(task.id, { important: !task.important })
                      .catch((e) =>
                        showMessage(
                          'Could not update task',
                          e instanceof Error ? e.message : String(e)
                        )
                      )
                  }
                />
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name={emptyState.icon} size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>{emptyState.title}</Text>
              <Text style={styles.emptyHint}>{emptyState.hint}</Text>
            </View>
          }
        />
      )}

      {(onBack || showAddBar) && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.bottomRow}>
            {onBack && (
              <Pressable style={styles.backButton} onPress={onBack} hitSlop={6}>
                <Ionicons name="chevron-back" size={24} color={accent} />
              </Pressable>
            )}
            {showAddBar && (
              <AddTaskBar
                accentColor={accent}
                placeholder={smart === 'someday' ? 'Add an idea' : undefined}
                onAdd={(payload) => handleAdd(payload)}
                style={styles.addBar}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      )}

      {list && (
        <>
          <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="List options">
            <SheetItem
              icon="create-outline"
              label={list.isDefault ? 'Change theme' : 'Rename & edit list'}
              onPress={() => {
                setMenuOpen(false);
                setEditOpen(true);
              }}
            />
            {!list.isDefault && mode === 'cloud' && (
              <SheetItem icon="person-add-outline" label="Share list" onPress={handleShare} />
            )}
            <SheetItem
              icon="folder-outline"
              label="Add section"
              onPress={() => {
                setMenuOpen(false);
                setSectionPrompt({ kind: 'add' });
              }}
            />
            <SheetItem
              icon="color-palette-outline"
              label="Change background"
              onPress={() => {
                setMenuOpen(false);
                setBgOpen(true);
              }}
            />
            <SheetItem
              icon={showCompleted ? 'eye-off-outline' : 'eye-outline'}
              label={showCompleted ? 'Hide completed tasks' : 'Show completed tasks'}
              onPress={() => {
                setShowCompleted((v) => !v);
                setMenuOpen(false);
              }}
            />
            {!list.isDefault && isOwner && (
              <SheetItem icon="trash-outline" label="Delete list" destructive onPress={handleDelete} />
            )}
            {!isOwner && (
              <SheetItem icon="exit-outline" label="Leave list" destructive onPress={handleLeave} />
            )}
          </Sheet>

          <ListEditorModal
            visible={editOpen}
            onClose={() => setEditOpen(false)}
            title={list.isDefault ? 'Change theme' : 'Edit list'}
            saveLabel="Save"
            initialName={list.name}
            initialColor={list.color}
            nameEditable={!list.isDefault}
            onSave={(name, color) =>
              api
                .updateList(list.id, { name, color })
                .catch((e) =>
                  showMessage('Could not update list', e instanceof Error ? e.message : String(e))
                )
            }
          />

          <ShareSheet
            visible={shareOpen}
            onClose={() => setShareOpen(false)}
            list={list}
            onLeft={onMissing}
          />

          <ChatSheet visible={chatOpen} onClose={() => setChatOpen(false)} list={list} />

          <PromptSheet
            visible={sectionPrompt != null}
            onClose={() => setSectionPrompt(null)}
            title={sectionPrompt?.kind === 'rename' ? 'Rename section' : 'New section'}
            placeholder="Section name"
            initialValue={sectionPrompt?.kind === 'rename' ? sectionPrompt.section.name : ''}
            saveLabel={sectionPrompt?.kind === 'rename' ? 'Save' : 'Create section'}
            onSave={(name) => {
              if (sectionPrompt?.kind === 'rename') renameSection(sectionPrompt.section, name);
              else addSection(name);
            }}
          />

          <Sheet
            visible={sectionMenu != null}
            onClose={() => setSectionMenu(null)}
            title={sectionMenu?.name}
          >
            <SheetItem
              icon="create-outline"
              label="Rename section"
              onPress={() => {
                const section = sectionMenu;
                setSectionMenu(null);
                if (section) setSectionPrompt({ kind: 'rename', section });
              }}
            />
            <SheetItem
              icon="trash-outline"
              label="Delete section"
              destructive
              onPress={() => {
                const section = sectionMenu;
                setSectionMenu(null);
                if (section) deleteSection(section);
              }}
            />
          </Sheet>
        </>
      )}

      <BackgroundSheet
        visible={bgOpen}
        onClose={() => setBgOpen(false)}
        current={backgroundId}
        onSelect={handlePickBackground}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  scrim: {
    backgroundColor: colors.dark ? 'rgba(27, 26, 25, 0.32)' : 'rgba(250, 249, 248, 0.16)',
  },
  textOnPhoto: {
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  dimTextOnPhoto: {
    color: 'rgba(255, 255, 255, 0.92)',
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 3,
  },
  membersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  memberOverlap: {
    marginLeft: -7,
  },
  membersLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  topIcon: {
    padding: 6,
    marginLeft: 6,
    marginTop: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexGrow: 1,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 12,
    marginBottom: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  sectionName: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  dropSlot: {
    height: 3,
    borderRadius: 2,
    marginVertical: 2,
    marginHorizontal: 4,
  },
  draggingRow: {
    opacity: 0.4,
  },
  dragHandle: {
    paddingLeft: 10,
    paddingVertical: 6,
  },
  completedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  completedTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginLeft: 6,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.12)',
  },
  addBar: {
    flex: 1,
  },
});
