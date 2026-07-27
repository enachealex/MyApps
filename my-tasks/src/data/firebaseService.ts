import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
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
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { Task, TaskList, UserProfile } from '../types';
import { listColors } from '../theme';
import { genShareCode } from '../utils/id';
import { auth, db } from './firebase';
import { buildList, buildTask, DataService, TaskDraft } from './service';
import { useAppStore } from './store';

/**
 * Cloud implementation backed by Firebase Auth + Firestore.
 * Subscribes to every list the user is a member of, and to the tasks of each
 * of those lists, pushing realtime updates into the store.
 */
class FirebaseService implements DataService {
  private listsUnsub: Unsubscribe | null = null;
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
      setDoc(
        doc(db(), 'users', user.id),
        { name: user.name, email: user.email },
        { merge: true }
      ).catch(() => {});
      this.subscribeLists(user.id);
    });
  }

  private teardown(): void {
    this.listsUnsub?.();
    this.listsUnsub = null;
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
          this.profileCache.set(id, {
            id,
            name: (data?.name as string) || 'Someone',
            email: (data?.email as string) ?? null,
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
    await setDoc(doc(db(), 'users', cred.user.uid), {
      name: name.trim(),
      email: email.trim(),
    });
    useAppStore.setState({
      user: { id: cred.user.uid, name: name.trim(), email: email.trim() },
    });
  }

  async signOutUser(): Promise<void> {
    await signOut(auth());
  }
}

export const firebaseService = new FirebaseService();
