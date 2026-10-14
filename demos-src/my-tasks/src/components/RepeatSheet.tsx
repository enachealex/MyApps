import type { Repeat } from '../types';
import { monthWeekdayRuleFor, repeatLabel, todayStr } from '../utils/dates';
import { Sheet, SheetItem } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  current: Repeat | null;
  /** Basis for the "monthly on the Nth weekday" option (the task's due date). */
  referenceDate?: string | null;
  onSelect: (repeat: Repeat | null) => void;
}

const BASICS: Repeat[] = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
const AFTER_COMPLETION: Repeat[] = ['after:3', 'after:7', 'after:30'];

export function RepeatSheet({ visible, onClose, current, referenceDate, onSelect }: Props) {
  const pick = (repeat: Repeat | null) => {
    onSelect(repeat);
    onClose();
  };

  const monthWeekday = monthWeekdayRuleFor(referenceDate ?? todayStr());

  return (
    <Sheet visible={visible} onClose={onClose} title="Repeat">
      {BASICS.map((option) => (
        <SheetItem
          key={option}
          icon="repeat"
          label={repeatLabel(option)}
          selected={current === option}
          onPress={() => pick(option)}
        />
      ))}
      <SheetItem
        icon="calendar-outline"
        label={repeatLabel(monthWeekday)}
        selected={current === monthWeekday}
        onPress={() => pick(monthWeekday)}
      />
      {AFTER_COMPLETION.map((option) => (
        <SheetItem
          key={option}
          icon="checkmark-done-outline"
          label={repeatLabel(option)}
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
