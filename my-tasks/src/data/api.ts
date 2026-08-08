import { completionFeedback } from '../feedback';
import type { Task } from '../types';
import { nextOccurrence, todayStr } from '../utils/dates';
import { isCloudEnabled } from './firebase';
import type { DataService } from './service';
import { firebaseService } from './firebaseService';
import { localService } from './localService';

/** The active data backend: Firestore when configured, on-device otherwise. */
export const api: DataService = isCloudEnabled ? firebaseService : localService;

export function initData(): Promise<void> {
  return api.init();
}

/**
 * Complete / un-complete a task. Completing a repeating task also creates the
 * next occurrence (mirroring Microsoft To Do).
 */
export async function toggleTaskCompleted(task: Task): Promise<void> {
  if (task.completed) {
    await api.updateTask(task.id, { completed: false, completedAt: null });
    return;
  }
  completionFeedback();
  await api.updateTask(task.id, { completed: true, completedAt: Date.now() });
  if (task.repeat) {
    const today = todayStr();
    let next = nextOccurrence(task.dueDate ?? today, task.repeat);
    while (next < today) next = nextOccurrence(next, task.repeat);
    await api.createTask({
      listId: task.listId,
      title: task.title,
      notes: task.notes,
      important: task.important,
      dueDate: next,
      repeat: task.repeat,
      assigneeId: task.assigneeId,
      steps: task.steps.map((s) => ({ ...s, completed: false })),
    });
  }
}
