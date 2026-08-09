import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  ImageBackground,
  KeyboardAvoidingView,
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
  getDefaultList,
  myDayIncompleteCount,
  tasksForSmartList,
  useAppStore,
} from '../data/store';
import type { SmartListId, Task } from '../types';
import { setSmartBackground, ThemeColors, useThemedStyles, useThemeStore } from '../theme';
import { addDaysStr, formatLongDate, todayStr } from '../utils/dates';
import { confirmDialog, showMessage } from '../utils/ui';
import { AddTaskBar, QuickAddPayload } from './AddTaskBar';
import { Avatar } from './Avatar';
import { BackgroundSheet } from './BackgroundSheet';
import { ChatSheet } from './ChatSheet';
import { ListEditorModal } from './ListEditorModal';
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
  | { kind: 'section'; key: string; title: string; count?: number; collapsible?: boolean };

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
  const backgroundId = list ? list.background ?? null : smart ? smartBackgrounds[smart] ?? null : null;
  const bgSource = backgroundSource(backgroundId);
  const onPhoto = bgSource != null;

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
    const incomplete = relevantTasks
      .filter((t) => !t.completed)
      .sort((a, b) => b.createdAt - a.createdAt);
    const completed = relevantTasks
      .filter((t) => t.completed)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

    const result: Row[] = [];
    if (smart === 'planned') {
      for (const group of plannedGroups(incomplete)) {
        result.push({ kind: 'section', key: `s:${group.title}`, title: group.title });
        for (const t of group.tasks) result.push({ kind: 'task', key: t.id, task: t });
      }
    } else {
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
  }, [relevantTasks, smart, showCompleted]);

  const listNameOf = (id: string) => lists.find((l) => l.id === id)?.name;

  const handleAdd = (payload: QuickAddPayload) => {
    const targetListId = listId ?? getDefaultList(lists, user?.id)?.id;
    if (!targetListId) return;
    const draft: TaskDraft = {
      listId: targetListId,
      title: payload.title,
      dueDate: payload.dueDate,
      important: payload.important || smart === 'important',
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
  const showAddBar = smart !== 'assigned';

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
            <Ionicons
              name="color-palette-outline"
              size={22}
              color={onPhoto ? '#FFFFFF' : accent}
            />
          </Pressable>
        )}
        {list && isShared && mode === 'cloud' && (
          <Pressable hitSlop={10} onPress={() => setChatOpen(true)} style={styles.topIcon}>
            <Ionicons name="chatbubbles-outline" size={22} color={accent} />
          </Pressable>
        )}
        {list && !list.isDefault && mode === 'cloud' && (
          <Pressable hitSlop={10} onPress={handleShare} style={styles.topIcon}>
            <Ionicons name="person-add-outline" size={22} color={accent} />
          </Pressable>
        )}
        {list && (
          <Pressable hitSlop={10} onPress={() => setMenuOpen(true)} style={styles.topIcon}>
            <Ionicons name="ellipsis-horizontal" size={22} color={accent} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
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
          return (
            <TaskItem
              task={item.task}
              accentColor={accent}
              listName={smart ? listNameOf(item.task.listId) : undefined}
              hideMyDayBadge={smart === 'myday'}
              onPress={() => onOpenTask(item.task.id)}
              onToggle={() =>
                toggleTaskCompleted(item.task).catch((e) =>
                  showMessage('Could not update task', e instanceof Error ? e.message : String(e))
                )
              }
              onToggleImportant={() =>
                api
                  .updateTask(item.task.id, { important: !item.task.important })
                  .catch((e) =>
                    showMessage('Could not update task', e instanceof Error ? e.message : String(e))
                  )
              }
            />
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
                onAdd={handleAdd}
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
