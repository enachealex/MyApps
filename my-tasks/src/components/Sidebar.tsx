import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { IconName } from '../constants';
import { SMART_LISTS, smartColor } from '../constants';
import { api } from '../data/api';
import {
  getDefaultList,
  incompleteCount,
  tasksForSmartList,
  useAppStore,
} from '../data/store';
import type { SmartListId } from '../types';
import { ThemeColors, useThemedStyles } from '../theme';
import { showMessage } from '../utils/ui';
import { AccountSheet } from './AccountSheet';
import { Avatar } from './Avatar';
import { FriendsSheet } from './FriendsSheet';
import { JoinSheet } from './JoinSheet';
import { ListEditorModal } from './ListEditorModal';

/** What is shown in the main pane: exactly one of smart / listId. */
export interface ListSelection {
  smart?: SmartListId;
  listId?: string;
}

interface Props {
  /** Highlighted entry (desktop two-pane mode); omit on phones. */
  selection?: ListSelection;
  onSelect: (selection: ListSelection) => void;
}

interface Row {
  key: string;
  icon: IconName;
  color: string;
  name: string;
  count: number;
  shared?: boolean;
  dividerAbove?: boolean;
  selected?: boolean;
  onPress: () => void;
}

export function Sidebar({ selection, onSelect }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const user = useAppStore((s) => s.user);
  const mode = useAppStore((s) => s.mode);

  const friends = useAppStore((s) => s.friends);

  const [newListOpen, setNewListOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);

  const hasFriendRequests = friends.some((f) => f.status === 'incoming');

  const defaultList = getDefaultList(lists, user?.id);
  const userLists = lists.filter((l) => !l.isDefault);

  const smartIds: SmartListId[] = ['myday', 'important', 'planned'];
  if (mode === 'cloud') smartIds.push('assigned');

  const rows: Row[] = smartIds.map((id) => {
    const meta = SMART_LISTS[id];
    return {
      key: `smart:${id}`,
      icon: meta.icon,
      color: smartColor(meta, colors.dark),
      name: meta.name,
      count: incompleteCount(tasksForSmartList(tasks, id, user?.id)),
      selected: selection?.smart === id,
      onPress: () => onSelect({ smart: id }),
    };
  });

  if (defaultList) {
    rows.push({
      key: 'default',
      icon: 'home-outline',
      color: colors.primary,
      name: defaultList.name,
      count: incompleteCount(tasks.filter((t) => t.listId === defaultList.id)),
      selected: selection?.listId === defaultList.id,
      onPress: () => onSelect({ listId: defaultList.id }),
    });
  }

  userLists.forEach((list, i) => {
    rows.push({
      key: `list:${list.id}`,
      icon: 'list-outline',
      color: list.color,
      name: list.name,
      count: incompleteCount(tasks.filter((t) => t.listId === list.id)),
      shared: list.memberIds.length > 1,
      dividerAbove: i === 0,
      selected: selection?.listId === list.id,
      onPress: () => onSelect({ listId: list.id }),
    });
  });

  const handleCreateList = async (name: string, color: string) => {
    try {
      const list = await api.createList(name, color);
      onSelect({ listId: list.id });
    } catch (e) {
      showMessage('Could not create list', e instanceof Error ? e.message : String(e));
    }
  };

  const handleJoinPress = () => {
    if (mode === 'cloud') {
      setJoinOpen(true);
    } else {
      showMessage(
        'Sharing needs cloud sync',
        'Add your Firebase config to firebase.config.ts (see README.md) to share lists with friends.'
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.profile} onPress={() => setAccountOpen(true)}>
          <Avatar id={user?.id ?? '?'} name={user?.name ?? '?'} size={40} />
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={1}>
              {user?.name}
            </Text>
            <Text style={styles.profileEmail} numberOfLines={1}>
              {user?.email ?? 'My Tasks'}
            </Text>
          </View>
        </Pressable>
        <Pressable
          hitSlop={10}
          onPress={() => {
            if (mode === 'cloud') setFriendsOpen(true);
            else
              showMessage(
                'Friends need cloud sync',
                'Add your Firebase config to firebase.config.ts (see README.md) to add friends and share lists.'
              );
          }}
          style={styles.joinButton}
        >
          <Ionicons name="people-outline" size={20} color={colors.primary} />
          {hasFriendRequests && <View style={styles.requestDot} />}
        </Pressable>
        <Pressable hitSlop={10} onPress={handleJoinPress} style={styles.joinButton}>
          <Ionicons name="person-add-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <>
            {item.dividerAbove && <View style={styles.divider} />}
            <Pressable
              style={({ pressed }) => [
                styles.row,
                item.selected && styles.rowSelected,
                pressed && styles.rowPressed,
              ]}
              onPress={item.onPress}
            >
              <Ionicons name={item.icon} size={20} color={item.color} />
              <Text style={styles.rowName} numberOfLines={1}>
                {item.name}
              </Text>
              {item.shared && (
                <Ionicons
                  name="people-outline"
                  size={15}
                  color={colors.textTertiary}
                  style={styles.sharedIcon}
                />
              )}
              {item.count > 0 && <Text style={styles.rowCount}>{item.count}</Text>}
            </Pressable>
          </>
        )}
      />

      <View style={styles.bottomBar}>
        <Pressable style={styles.newListButton} onPress={() => setNewListOpen(true)}>
          <Ionicons name="add" size={22} color={colors.primary} />
          <Text style={styles.newListText}>New list</Text>
        </Pressable>
      </View>

      <ListEditorModal
        visible={newListOpen}
        onClose={() => setNewListOpen(false)}
        title="New list"
        saveLabel="Create list"
        onSave={handleCreateList}
      />
      <JoinSheet
        visible={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={(listId) => onSelect({ listId })}
      />
      <AccountSheet visible={accountOpen} onClose={() => setAccountOpen(false)} />
      <FriendsSheet visible={friendsOpen} onClose={() => setFriendsOpen(false)} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  profile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileText: {
    marginLeft: 10,
    flex: 1,
  },
  profileName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  profileEmail: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  joinButton: {
    padding: 6,
  },
  requestDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  listContent: {
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 6,
  },
  rowSelected: {
    backgroundColor: colors.selected,
  },
  rowPressed: {
    backgroundColor: colors.pressed,
  },
  rowName: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    marginLeft: 12,
  },
  sharedIcon: {
    marginRight: 8,
  },
  rowCount: {
    fontSize: 12,
    color: colors.textSecondary,
    minWidth: 18,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
    marginHorizontal: 8,
  },
  bottomBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  newListButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  newListText: {
    fontSize: 14,
    color: colors.primary,
    marginLeft: 10,
    fontWeight: '500',
  },
});
