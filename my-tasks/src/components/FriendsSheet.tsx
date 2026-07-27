import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../data/api';
import { useAppStore } from '../data/store';
import { ThemeColors, useThemedStyles } from '../theme';
import type { FriendEntry } from '../types';
import { confirmDialog, showMessage } from '../utils/ui';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function FriendsSheet({ visible, onClose }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const friends = useAppStore((s) => s.friends);

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (visible) {
      setEmail('');
      setBusy(false);
      setNotice(null);
    }
  }, [visible]);

  const incoming = friends.filter((f) => f.status === 'incoming');
  const outgoing = friends.filter((f) => f.status === 'outgoing');
  const accepted = friends.filter((f) => f.status === 'accepted');

  const sendRequest = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.addFriendByEmail(email);
      setEmail('');
      setNotice({ text: 'Request sent!', error: false });
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Something went wrong.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const respond = (friend: FriendEntry, accept: boolean) => {
    api
      .respondToFriendRequest(friend.uid, accept)
      .catch((e) => showMessage('Could not update request', e instanceof Error ? e.message : String(e)));
  };

  const remove = (friend: FriendEntry) => {
    confirmDialog(
      'Remove friend',
      `Remove ${friend.name} from your friends? Shared lists are not affected.`,
      'Remove',
      () =>
        api
          .removeFriend(friend.uid)
          .catch((e) => showMessage('Could not remove friend', e instanceof Error ? e.message : String(e)))
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Friends">
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Text style={styles.hint}>
            Add a friend by email. Their address is only used to find their account — it is
            never stored.
          </Text>
          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="friend@example.com"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onSubmitEditing={sendRequest}
              returnKeyType="send"
            />
            <Pressable
              style={[styles.addButton, (!email.trim() || busy) && styles.disabled]}
              onPress={sendRequest}
              disabled={!email.trim() || busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="person-add" size={18} color="#fff" />
              )}
            </Pressable>
          </View>
          {notice && (
            <Text style={[styles.notice, notice.error ? styles.noticeError : styles.noticeOk]}>
              {notice.text}
            </Text>
          )}

          {incoming.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Requests</Text>
              {incoming.map((f) => (
                <View key={f.uid} style={styles.row}>
                  <Avatar id={f.uid} name={f.name} size={32} />
                  <Text style={styles.rowName}>{f.name}</Text>
                  <Pressable
                    hitSlop={8}
                    style={[styles.iconButton, styles.acceptButton]}
                    onPress={() => respond(f, true)}
                  >
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  </Pressable>
                  <Pressable hitSlop={8} style={styles.iconButton} onPress={() => respond(f, false)}>
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
              ))}
            </>
          )}

          {outgoing.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Sent</Text>
              {outgoing.map((f) => (
                <View key={f.uid} style={styles.row}>
                  <Avatar id={f.uid} name={f.name} size={32} />
                  <Text style={styles.rowName}>{f.name}</Text>
                  <Text style={styles.pending}>Pending</Text>
                  <Pressable hitSlop={8} style={styles.iconButton} onPress={() => respond(f, false)}>
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
              ))}
            </>
          )}

          <Text style={styles.sectionTitle}>
            {accepted.length > 0 ? `Friends (${accepted.length})` : 'Friends'}
          </Text>
          {accepted.length === 0 ? (
            <Text style={styles.empty}>
              No friends yet. Add someone by email and start sharing lists.
            </Text>
          ) : (
            accepted.map((f) => (
              <View key={f.uid} style={styles.row}>
                <Avatar id={f.uid} name={f.name} size={32} />
                <Text style={styles.rowName}>{f.name}</Text>
                <Pressable hitSlop={8} style={styles.iconButton} onPress={() => remove(f)}>
                  <Ionicons name="trash-outline" size={17} color={colors.textSecondary} />
                </Pressable>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    scroll: {
      maxHeight: 480,
    },
    body: {
      paddingHorizontal: 20,
    },
    hint: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 10,
      lineHeight: 18,
    },
    addRow: {
      flexDirection: 'row',
      gap: 8,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
    },
    addButton: {
      width: 44,
      borderRadius: 6,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disabled: {
      opacity: 0.4,
    },
    notice: {
      fontSize: 13,
      marginTop: 8,
    },
    noticeError: {
      color: colors.danger,
    },
    noticeOk: {
      color: colors.primary,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 18,
      marginBottom: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      gap: 10,
    },
    rowName: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
    },
    pending: {
      fontSize: 12,
      color: colors.textTertiary,
    },
    iconButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    acceptButton: {
      backgroundColor: colors.primary,
    },
    empty: {
      fontSize: 13,
      color: colors.textTertiary,
      paddingVertical: 6,
    },
  });
