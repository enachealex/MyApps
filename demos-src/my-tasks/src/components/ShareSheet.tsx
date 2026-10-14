import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../data/api';
import { useAppStore } from '../data/store';
import type { TaskList } from '../types';
import { ThemeColors, useThemedStyles } from '../theme';
import { confirmDialog, showMessage } from '../utils/ui';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  list: TaskList;
  /** Called after the current user leaves the list. */
  onLeft: () => void;
}

export function ShareSheet({ visible, onClose, list, onLeft }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const members = useAppStore((s) => s.members);
  const user = useAppStore((s) => s.user);
  const friends = useAppStore((s) => s.friends);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const isOwner = user?.id === list.ownerId;

  const invitableFriends = friends.filter(
    (f) => f.status === 'accepted' && !list.memberIds.includes(f.uid)
  );

  const inviteFriend = (friendUid: string) => {
    api
      .inviteFriendToList(list.id, friendUid)
      .catch((e) =>
        showMessage('Could not invite friend', e instanceof Error ? e.message : String(e))
      );
  };

  const createCode = async () => {
    setBusy(true);
    try {
      await api.shareList(list.id);
    } catch (e) {
      showMessage('Could not share list', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!list.shareCode) return;
    await Clipboard.setStringAsync(list.shareCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leave = () => {
    confirmDialog(
      'Leave list',
      `You will lose access to "${list.name}" until someone invites you again.`,
      'Leave',
      async () => {
        try {
          await api.leaveList(list.id);
          onClose();
          onLeft();
        } catch (e) {
          showMessage('Could not leave list', e instanceof Error ? e.message : String(e));
        }
      }
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Share list">
      <View style={styles.body}>
        {list.shareCode ? (
          <>
            <Text style={styles.hint}>
              Friends can join this list from the Home screen using this invite code:
            </Text>
            <View style={styles.codeRow}>
              <Text style={styles.code}>{list.shareCode}</Text>
              <Pressable style={styles.copyButton} onPress={copyCode}>
                <Ionicons
                  name={copied ? 'checkmark' : 'copy-outline'}
                  size={16}
                  color={colors.primary}
                />
                <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Create an invite code so friends can join this list and work on it with you.
            </Text>
            <Pressable style={styles.shareButton} onPress={createCode} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.shareButtonText}>Create invite code</Text>
              )}
            </Pressable>
          </>
        )}

        {invitableFriends.length > 0 && (
          <>
            <Text style={styles.membersTitle}>Invite a friend</Text>
            {invitableFriends.map((f) => (
              <View key={f.uid} style={styles.memberRow}>
                <Avatar id={f.uid} name={f.name} size={32} />
                <Text style={styles.memberName}>{f.name}</Text>
                <Pressable style={styles.inviteButton} onPress={() => inviteFriend(f.uid)}>
                  <Text style={styles.inviteButtonText}>Invite</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        <Text style={styles.membersTitle}>Members</Text>
        {list.memberIds.map((id) => {
          const profile = members[id];
          return (
            <View key={id} style={styles.memberRow}>
              <Avatar id={id} name={profile?.name ?? '?'} size={32} />
              <Text style={styles.memberName}>
                {profile?.name ?? 'Someone'}
                {id === user?.id ? ' (me)' : ''}
              </Text>
              {id === list.ownerId && <Text style={styles.ownerBadge}>Owner</Text>}
            </View>
          );
        })}

        {!isOwner && (
          <Pressable style={styles.leaveButton} onPress={leave}>
            <Ionicons name="exit-outline" size={18} color={colors.danger} />
            <Text style={styles.leaveText}>Leave list</Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  body: {
    paddingHorizontal: 20,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  code: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 4,
    color: colors.text,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  copyText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  shareButton: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  membersTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 20,
    marginBottom: 6,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  memberName: {
    flex: 1,
    marginLeft: 12,
    fontSize: 15,
    color: colors.text,
  },
  ownerBadge: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  inviteButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  inviteButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 10,
  },
  leaveText: {
    color: colors.danger,
    fontSize: 15,
  },
});
