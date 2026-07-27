import { create } from 'zustand';
import type { FriendEntry, SmartListId, Task, TaskList, UserProfile } from '../types';
import { todayStr } from '../utils/dates';

export type Mode = 'local' | 'cloud';

export interface AppState {
  mode: Mode;
  /** True once we know whether a user is signed in (cloud) or local data is loaded. */
  authReady: boolean;
  /** True once lists/tasks have been loaded at least once. */
  dataReady: boolean;
  user: UserProfile | null;
  lists: TaskList[];
  tasks: Task[];
  /** Profiles of everyone who shares a list with us, keyed by user id. */
  members: Record<string, UserProfile>;
  /** Friend connections: accepted friends plus pending requests (cloud mode). */
  friends: FriendEntry[];
}

export const useAppStore = create<AppState>(() => ({
  mode: 'local',
  authReady: false,
  dataReady: false,
  user: null,
  lists: [],
  tasks: [],
  members: {},
  friends: [],
}));

export function getDefaultList(lists: TaskList[], uid?: string): TaskList | undefined {
  if (uid) {
    const own = lists.find((l) => l.isDefault && l.ownerId === uid);
    if (own) return own;
  }
  return lists.find((l) => l.isDefault);
}

export function tasksForSmartList(tasks: Task[], smart: SmartListId, uid?: string): Task[] {
  const today = todayStr();
  switch (smart) {
    case 'myday':
      return tasks.filter((t) => t.myDayDate === today);
    case 'important':
      return tasks.filter((t) => t.important);
    case 'planned':
      return tasks.filter((t) => t.dueDate != null);
    case 'assigned':
      return tasks.filter((t) => t.assigneeId != null && t.assigneeId === uid);
  }
}

/** Count shown next to a list on the Home screen: incomplete tasks only. */
export function incompleteCount(tasks: Task[]): number {
  return tasks.reduce((n, t) => n + (t.completed ? 0 : 1), 0);
}
