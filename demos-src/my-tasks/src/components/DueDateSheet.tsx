import { useEffect, useState } from 'react';
import { addDaysStr, parseDateStr, todayStr } from '../utils/dates';
import { DatePickerField } from './DatePickerField';
import { Sheet, SheetItem } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  current: string | null;
  onSelect: (date: string | null) => void;
}

function weekdayShort(dateStr: string): string {
  return parseDateStr(dateStr).toLocaleDateString(undefined, { weekday: 'short' });
}

export function DueDateSheet({ visible, onClose, current, onSelect }: Props) {
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!visible) setPicking(false);
  }, [visible]);

  const pick = (date: string | null) => {
    onSelect(date);
    onClose();
  };

  const today = todayStr();
  const tomorrow = addDaysStr(today, 1);
  const nextWeek = addDaysStr(today, 7);

  return (
    <Sheet visible={visible} onClose={onClose} title="Due date">
      {picking ? (
        <DatePickerField value={current} onPick={pick} onCancel={() => setPicking(false)} />
      ) : (
        <>
          <SheetItem
            icon="today-outline"
            label="Today"
            rightText={weekdayShort(today)}
            onPress={() => pick(today)}
          />
          <SheetItem
            icon="arrow-forward-circle-outline"
            label="Tomorrow"
            rightText={weekdayShort(tomorrow)}
            onPress={() => pick(tomorrow)}
          />
          <SheetItem
            icon="calendar-outline"
            label="Next week"
            rightText={weekdayShort(nextWeek)}
            onPress={() => pick(nextWeek)}
          />
          <SheetItem
            icon="calendar-number-outline"
            label="Pick a date"
            onPress={() => setPicking(true)}
          />
          {current != null && (
            <SheetItem
              icon="trash-outline"
              label="Remove due date"
              destructive
              onPress={() => pick(null)}
            />
          )}
        </>
      )}
    </Sheet>
  );
}
