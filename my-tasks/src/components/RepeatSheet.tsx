import type { Repeat } from '../types';
import { REPEAT_LABELS } from '../utils/dates';
import { Sheet, SheetItem } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  current: Repeat | null;
  onSelect: (repeat: Repeat | null) => void;
}

const OPTIONS = Object.keys(REPEAT_LABELS) as Repeat[];

export function RepeatSheet({ visible, onClose, current, onSelect }: Props) {
  const pick = (repeat: Repeat | null) => {
    onSelect(repeat);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Repeat">
      {OPTIONS.map((option) => (
        <SheetItem
          key={option}
          icon="repeat"
          label={REPEAT_LABELS[option]}
          selected={current === option}
          onPress={() => pick(option)}
        />
      ))}
      {current != null && (
        <SheetItem icon="close-circle-outline" label="Never" destructive onPress={() => pick(null)} />
      )}
    </Sheet>
  );
}
