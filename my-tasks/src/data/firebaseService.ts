import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import type { ChatMessage, FriendEntry, FriendStatus, Task, TaskList, UserProfile } from '../types';
import { listColors } from '../theme';
import { emailHash } from '../utils/hash';
import { genShareCode } from '../utils/id';
import { auth, db } from './firebase';
import { buildList, buildTask, DataService, TaskDraft } from './service';
import { useAppStore } from './store';

/** Firestore edge-doc statuses; mapped to FriendStatus for the UI. */
const EDGE_TO_STATUS: Record<string, FriendStatus> = {
  'pending-sent': 'outgoing',
  'pending-received': 'incoming',
  accepted: 'accepted',
};

/**
 * Cloud implementation backed by Firebase Auth + Firestore.
 * Subscribes to every list the user is a member of, and to the tasks of each
 * of those lists, pushing realtime updates into the store.
 */
class FirebaseService implements DataService {
  private listsUnsub: Unsubscribe | null = null;
  private friendsUnsub: Unsubscribe | null = null;
  private taskUnsubs = new Map<string, Unsubscribe>();
  private tasksByList = new Map<string, Task[]>();
  private lists: TaskList[] = [];
  private profileCache = new Map<string, UserProfile>();
  private creatingDefault = false;

  async init(): Promise<void> {
    useAppStore.setState({ mode: 'cloud' });
    onAuthStateChanged(auth(), (fbUser) => {
      this.teardown();
      if (!fbUser) {
        useAppStore.setState({
          authReady: true,
          dataReady: false,
          user: null,
          lists: [],
          tasks: [],
          members: {},
          friends: [],
        });
        return;
      }
      const user: UserProfile = {
        id: fbUser.uid,
        name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Me',
        email: fbUser.email,
      };
      useAppStore.setState({ authReady: true, user });
      this.profileCache.set(user.id, user);
      this.writeOwnProfile(user.id, user.name, fbUser.email);
      this.subscribeLists(user.id);
      this.subscribeFriends(user.id);
    });
  }

  /**
   * The profile doc other users can see. Deliberately contains NO email
   * address — only the display name and a one-way hash used so friends can
   * find each other by typing an email that is never stored.
   */
  private writeOwnProfile(uid: string, name: string, email: string | null): void {
    (async () => {
      const hash = email ? await emailHash(email) : null;
      await setDoc(doc(db(), 'users', uid), { name, emailHash: hash }, { merge: true });
    })().catch(() => {});
  }

  private teardown(): void {
    this.listsUnsub?.();
    this.listsUnsub = null;
    this.friendsUnsub?.();
    this.friendsUnsub = null;
    for (const unsub of this.taskUnsubs.values()) unsub();
    this.taskUnsubs.clear();
    this.tasksByList.clear();
    this.lists = [];
  }

  private uid(): string {
    const user = useAppStore.getState().user;
    if (!user) throw new Error('Not signed in');
    return user.id;
  }

  private subscribeLists(uid: string): void {
    const q = query(collection(db(), 'lists'), where('memberIds', 'array-contains', uid));
    this.listsUnsub = onSnapshot(
      q,
      (snap) => {
        const lists = snap.docs.map((d) => ({ ...(d.data() as TaskList), id: d.id }));
        lists.sort(
          (a, b) =>
            Number(b.isDefault ?? false) - Number(a.isDefault ?? false) ||
            a.createdAt - b.createdAt
        );
        this.lists = lists;

        // First sign-in on this account: create the built-in "Tasks" list.
        if (!snap.metadata.fromCache && !this.creatingDefault) {
          if (!lists.some((l) => l.isDefault && l.ownerId === uid)) {
            this.creatingDefault = true;
            this.createListInternal('Tasks', listColors[0], true).catch((e) =>
              console.warn('Failed to create default list', e)
            );
          }
        }

        // Keep one task subscription per list we belong to.
        const ids = new Set(lists.map((l) => l.id));
        for (const [listId, unsub] of [...this.taskUnsubs]) {
          if (!ids.has(listId)) {
            unsub();
            this.taskUnsubs.delete(listId);
            this.tasksByList.delete(listId);
          }
        }
        for (const list of lists) {
          if (!this.taskUnsubs.has(list.id)) this.subscribeTasks(list.id);
        }

        this.fetchProfiles(lists);
        this.pushState();
        useAppStore.setState({ dataReady: true });
      },
      (err) => console.warn('Lists subscription error', err)
    );
  }

  private subscribeFriends(uid: string): void {
    this.friendsUnsub = onSnapshot(
      collection(db(), 'users', uid, 'friends'),
      (snap) => {
        const friends: FriendEntry[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            uid: d.id,
            name: (data.name as string) || 'Someone',
            status: EDGE_TO_STATUS[data.status as string] ?? 'accepted',
            createdAt: (data.createdAt as number) ?? 0,
          };
        });
        friends.sort((a, b) => a.name.localeCompare(b.name));
        useAppStore.setState({ friends });
      },
      (err) => console.warn('Friends subscription error', err)
    );
  }

  private subscribeTasks(listId: string): void {
    const q = query(collection(db(), 'tasks'), where('listId', '==', listId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        this.tasksByList.set(
          listId,
          snap.docs.map((d) => ({ ...(d.data() as Task), id: d.id }))
        );
        this.pushState();
      },
      (err) => console.warn('Tasks subscription error', err)
    );
    this.taskUnsubs.set(listId, unsub);
  }

  private pushState(): void {
    const tasks: Task[] = [];
    for (const listTasks of this.tasksByList.values()) tasks.push(...listTasks);
    useAppStore.setState({ lists: [...this.lists], tasks });
  }

  private async fetchProfiles(lists: TaskList[]): Promise<void> {
    const needed = new Set<string>();
    for (const list of lists) for (const id of list.memberIds) needed.add(id);
    const missing = [...needed].filter((id) => !this.profileCache.has(id));
    await Promise.all(
      missing.map(async (id) => {
        try {
          const snap = await getDoc(doc(db(), 'users', id));
          const data = snap.data();
          // Profile docs hold no email address, only a hash — so there is
          // nothing personal to surface here beyond the display name.
          this.profileCache.set(id, {
            id,
            name: (data?.name as string) || 'Someone',
            email: null,
          });
        } catch {
          this.profileCache.set(id, { id, name: 'Someone', email: null });
        }
      })
    );
    const members: Record<string, UserProfile> = {};
    for (const id of needed) {
      const profile = this.profileCache.get(id);
      if (profile) members[id] = profile;
    }
    useAppStore.setState({ members });
  }

  private async createListInternal(
    name: string,
    color: string,
    isDefault: boolean
  ): Promise<TaskList> {
    const ref = doc(collection(db(), 'lists'));
    const list = buildList(name, color, this.uid(), ref.id, isDefault);
    await setDoc(ref, list);
    return list;
  }

  createList(name: string, color: string): Promise<TaskList> {
    return this.createListInternal(name, color, false);
  }

  async updateList(id: string, patch: Partial<TaskList>): Promise<void> {
    await updateDoc(doc(db(), 'lists', id), {
      ...(patch as DocumentData),
      updatedAt: Date.now(),
    });
  }

  async deleteList(id: string): Promise<void> {
    const list = this.lists.find((l) => l.id === id);
    const taskSnap = await getDocs(query(collection(db(), 'tasks'), where('listId', '==', id)));
    const batch = writeBatch(db());
    for (const d of taskSnap.docs) batch.delete(d.ref);
    if (list?.shareCode) batch.delete(doc(db(), 'invites', list.shareCode));
    batch.delete(doc(db(), 'lists', id));
    await batch.commit();
  }

  async createTask(draft: TaskDraft): Promise<Task> {
    const ref = doc(collection(db(), 'tasks'));
    const task = buildTask(draft, this.uid(), ref.id);
    await setDoc(ref, task);
    return task;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<void> {
    await updateDoc(doc(db(), 'tasks', id), {
      ...(patch as DocumentData),
      updatedAt: Date.now(),
    });
  }

  async deleteTask(id: string): Promise<void> {
    await deleteDoc(doc(db(), 'tasks', id));
  }

  async shareList(listId: string): Promise<string> {
    const list = this.lists.find((l) => l.id === listId);
    if (!list) throw new Error('List not found');
    if (list.shareCode) return list.shareCode;
    const code = genShareCode();
    await setDoc(doc(db(), 'invites', code), {
      listId,
      createdBy: this.uid(),
      createdAt: Date.now(),
    });
    await updateDoc(doc(db(), 'lists', listId), { shareCode: code });
    return code;
  }

  async joinList(rawCode: string): Promise<string> {
    const code = rawCode.trim().toUpperCase();
    if (!code) throw new Error('Enter an invite code.');
    const invite = await getDoc(doc(db(), 'invites', code));
    if (!invite.exists()) {
      throw new Error('That code was not found. Double-check it with your friend.');
    }
    const listId = invite.data().listId as string;
    await updateDoc(doc(db(), 'lists', listId), { memberIds: arrayUnion(this.uid()) });
    return listId;
  }

  async leaveList(listId: string): Promise<void> {
    await updateDoc(doc(db(), 'lists', listId), { memberIds: arrayRemove(this.uid()) });
  }

  async signIn(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(auth(), email.trim(), password);
  }

  async signUp(name: string, email: string, password: string): Promise<void> {
    const cred = await createUserWithEmailAndPassword(auth(), email.trim(), password);
    await updateProfile(cred.user, { displayName: name.trim() });
    this.writeOwnProfile(cred.user.uid, name.trim(), email);
    useAppStore.setState({
      user: { id: cred.user.uid, name: name.trim(), email: email.trim() },
    });
  }

  async signInWithGoogle(): Promise<void> {
    if (Platform.OS !== 'web') {
      throw new Error(
        'Google sign-in is available in the web app for now. Sign in with email on this device.'
      );
    }
    await signInWithPopup(auth(), new GoogleAuthProvider());
  }

  async signOutUser(): Promise<void> {
    await signOut(auth());
  }

  async addFriendByEmail(email: string): Promise<void> {
    const me = this.uid();
    const myName = useAppStore.getState().user?.name ?? 'Someone';
    const trimmed = email.trim();
    if (!trimmed) throw new Error('Enter an email address.');

    // Look up by one-way hash: their address is never stored or transmitted
    // to the database in readable form.
    const hash = await emailHash(trimmed);
    const match = await getDocs(
      query(collection(db(), 'users'), where('emailHash', '==', hash), limit(1))
    );
    if (match.empty) {
      throw new Error('No account found for that email. Ask your friend to sign up first.');
    }
    const friendUid = match.docs[0].id;
    const friendName = (match.docs[0].data().name as string) || 'Someone';
    if (friendUid === me) throw new Error("That's your own email.");

    const existing = await getDoc(doc(db(), 'users', me, 'friends', friendUid));
    if (existing.exists()) {
      const status = existing.data().status as string;
      if (status === 'accepted') throw new Error(`You and ${friendName} are already friends.`);
      if (status === 'pending-sent') throw new Error('Request already sent — waiting on them.');
      // They already asked us: accept instead of re-requesting.
      await this.respondToFriendRequest(friendUid, true);
      return;
    }

    const now = Date.now();
    const batch = writeBatch(db());
    batch.set(doc(db(), 'users', me, 'friends', friendUid), {
      status: 'pending-sent',
      name: friendName,
      createdAt: now,
    });
    batch.set(doc(db(), 'users', friendUid, 'friends', me), {
      status: 'pending-received',
      name: myName,
      createdAt: now,
    });
    await batch.commit();
  }

  async respondToFriendRequest(friendUid: string, accept: boolean): Promise<void> {
    const me = this.uid();
    const batch = writeBatch(db());
    if (accept) {
      batch.update(doc(db(), 'users', me, 'friends', friendUid), { status: 'accepted' });
      batch.update(doc(db(), 'users', friendUid, 'friends', me), { status: 'accepted' });
    } else {
      batch.delete(doc(db(), 'users', me, 'friends', friendUid));
      batch.delete(doc(db(), 'users', friendUid, 'friends', me));
    }
    await batch.commit();
  }

  async removeFriend(friendUid: string): Promise<void> {
    await this.respondToFriendRequest(friendUid, false);
  }

  async inviteFriendToList(listId: string, friendUid: string): Promise<void> {
    await updateDoc(doc(db(), 'lists', listId), { memberIds: arrayUnion(friendUid) });
  }

  watchMessages(listId: string, onMessages: (messages: ChatMessage[]) => void): () => void {
    const q = query(collection(db(), 'messages'), where('listId', '==', listId));
    return onSnapshot(
      q,
      (snap) => {
        const messages = snap.docs.map((d) => ({ ...(d.data() as ChatMessage), id: d.id }));
        messages.sort((a, b) => a.createdAt - b.createdAt);
        onMessages(messages);
      },
      (err) => console.warn('Messages subscription error', err)
    );
  }

  async sendMessage(listId: string, text: string): Promise<void> {
    const body = text.trim();
    if (!body) return;
    const ref = doc(collection(db(), 'messages'));
    await setDoc(ref, {
      listId,
      authorId: this.uid(),
      text: body,
      createdAt: Date.now(),
    });
  }
}

export const firebaseService = new FirebaseService();
