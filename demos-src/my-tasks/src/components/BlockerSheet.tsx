import { useAppStore } from '../data/store';
import { api } from '../data/api';
import type { Task } from '../types';
import { showMessage } from '../utils/ui';
import { Sheet, SheetItem } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  task: Task;
}

/** Pick a prerequisite task from the same list. */
export function BlockerSheet({ visible, onClose, task }: Props) {
  const tasks = useAppStore((s) => s.tasks);

  // Same list, incomplete, not itself, and not already blocked BY this task
  // (avoids the obvious two-task deadlock).
  const candidates = tasks
    .filter(
      (t) =>
        t.listId === task.listId &&
        t.id !== task.id &&
        !t.completed &&
        t.blockedBy !== task.id
    )
    .slice(0, 30);

  const pick = (blockedBy: string | null) => {
    onClose();
    api
      .updateTask(task.id, { blockedBy })
      .catch((e) =>
        showMessage('Could not update task', e instanceof Error ? e.message : String(e))
      );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Blocked by">
      {candidates.map((t) => (
        <SheetItem
          key={t.id}
          icon="lock-closed-outline"
          label={t.title}
          selected={task.blockedBy === t.id}
          onPress={() => pick(t.id)}
        />
      ))}
      {task.blockedBy != null && (
        <SheetItem
          icon="lock-open-outline"
          label="Remove blocker"
          destructive
          onPress={() => pick(null)}
        />
      )}
    </Sheet>
  );
}
