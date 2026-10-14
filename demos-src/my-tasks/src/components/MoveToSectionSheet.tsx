import { api } from '../data/api';
import type { Task, TaskList } from '../types';
import { showMessage } from '../utils/ui';
import { Sheet, SheetItem } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  list: TaskList;
  task: Task;
}

export function MoveToSectionSheet({ visible, onClose, list, task }: Props) {
  const sections = [...(list.sections ?? [])].sort((a, b) => a.order - b.order);

  const move = (sectionId: string | null) => {
    onClose();
    api
      .updateTask(task.id, { sectionId, order: -Date.now() })
      .catch((e) =>
        showMessage('Could not move task', e instanceof Error ? e.message : String(e))
      );
  };

  const current = task.sectionId ?? null;

  return (
    <Sheet visible={visible} onClose={onClose} title="Move to section">
      <SheetItem
        icon="remove-circle-outline"
        label="No section"
        selected={current == null || !sections.some((s) => s.id === current)}
        onPress={() => move(null)}
      />
      {sections.map((section) => (
        <SheetItem
          key={section.id}
          icon="folder-outline"
          label={section.name}
          selected={current === section.id}
          onPress={() => move(section.id)}
        />
      ))}
    </Sheet>
  );
}
