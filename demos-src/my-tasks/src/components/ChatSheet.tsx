import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../data/api';
import { useAppStore } from '../data/store';
import { ThemeColors, useThemedStyles } from '../theme';
import type { ChatMessage, TaskList } from '../types';
import { showMessage } from '../utils/ui';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  list: TaskList;
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

export function ChatSheet({ visible, onClose, list }: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const user = useAppStore((s) => s.user);
  const members = useAppStore((s) => s.members);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!visible) return;
    const unsub = api.watchMessages(list.id, setMessages);
    return unsub;
  }, [visible, list.id]);

  // FlatList is inverted so new messages sit next to the input; the data is
  // reversed to match.
  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    api
      .sendMessage(list.id, body)
      .catch((e) => showMessage('Could not send message', e instanceof Error ? e.message : String(e)));
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={`${list.name} — chat`}>
      <View style={styles.container}>
        <FlatList
          data={reversed}
          inverted
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const mine = item.authorId === user?.id;
            const author = members[item.authorId]?.name ?? 'Someone';
            return (
              <View style={[styles.messageRow, mine && styles.messageRowMine]}>
                {!mine && (
                  <View style={styles.messageAvatar}>
                    <Avatar id={item.authorId} name={author} size={26} />
                  </View>
                )}
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  {!mine && <Text style={styles.author}>{author}</Text>}
                  <Text style={[styles.messageText, mine && styles.messageTextMine]}>
                    {item.text}
                  </Text>
                  <Text style={[styles.time, mine && styles.timeMine]}>
                    {timeLabel(item.createdAt)}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={36} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                No messages yet. Talk about this list with everyone in it.
              </Text>
            </View>
          }
        />
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={colors.textSecondary}
            onSubmitEditing={send}
            submitBehavior="submit"
            blurOnSubmit={false}
            returnKeyType="send"
          />
          <Pressable
            style={[styles.sendButton, !text.trim() && styles.sendDisabled]}
            onPress={send}
            disabled={!text.trim()}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      height: 460,
      paddingHorizontal: 14,
    },
    messages: {
      paddingVertical: 8,
      flexGrow: 1,
    },
    messageRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      marginBottom: 8,
      paddingRight: 40,
    },
    messageRowMine: {
      justifyContent: 'flex-end',
      paddingRight: 0,
      paddingLeft: 40,
    },
    messageAvatar: {
      marginRight: 6,
    },
    bubble: {
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
      maxWidth: '100%',
    },
    bubbleTheirs: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 4,
    },
    bubbleMine: {
      backgroundColor: colors.primary,
      borderBottomRightRadius: 4,
    },
    author: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 2,
    },
    messageText: {
      fontSize: 14,
      color: colors.text,
    },
    messageTextMine: {
      color: '#fff',
    },
    time: {
      fontSize: 10,
      color: colors.textTertiary,
      marginTop: 3,
      alignSelf: 'flex-end',
    },
    timeMine: {
      color: 'rgba(255, 255, 255, 0.75)',
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      transform: [{ scaleY: -1 }],
      paddingHorizontal: 30,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: 8,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 9,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    sendButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendDisabled: {
      opacity: 0.4,
    },
  });
