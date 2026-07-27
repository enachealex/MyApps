import { StyleSheet, View } from 'react-native';
import { useAppStore } from '../data/store';
import type { TaskList } from '../types';
import { Avatar } from './Avatar';
import { Sheet, SheetItem } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  list: TaskList;
  currentAssigneeId: string | null;
  onSelect: (assigneeId: string | null) => void;
}

export function AssignSheet({ visible, onClose, list, currentAssigneeId, onSelect }: Props) {
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);

  const pick = (id: string | null) => {
    onSelect(id);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Assign to">
      {list.memberIds.map((id) => {
        const profile = members[id];
        const name = id === user?.id ? `${profile?.name ?? 'Me'} (me)` : profile?.name ?? 'Someone';
        return (
          <SheetItem
            key={id}
            label={name}
            selected={currentAssigneeId === id}
            onPress={() => pick(id)}
            right={
              <View style={styles.avatar}>
                <Avatar id={id} name={profile?.name ?? '?'} size={28} />
              </View>
            }
          />
        );
      })}
      {currentAssigneeId != null && (
        <SheetItem
          icon="close-circle-outline"
          label="Remove assignment"
          destructive
          onPress={() => pick(null)}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  avatar: {
    marginRight: 8,
  },
});
