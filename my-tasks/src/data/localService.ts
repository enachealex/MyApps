import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Task, TaskList, UserProfile } from '../types';
import { listColors } from '../theme';
import { genId } from '../utils/id';
import { buildList, buildTask, DataService, TaskDraft } from './service';
import { useAppStore } from './store';

const STORAGE_KEY = 'my-tasks/local/v1';

interface Snapshot {
  user: UserProfile;
  lists: TaskList[];
  tasks: Task[];
}

/**
 * Single-device implementation backed by AsyncStorage. Used when Firebase
 * is not configured. Sharing features are unavailable in this mode.
 */
class LocalService implements DataService {
  private user: UserProfile = { id: 'local-user', name: 'You', email: null };
  private lists: TaskList[] = [];
  private tasks: Task[] = [];

  async init(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const snap = JSON.parse(raw) as Snapshot;
        this.user = snap.user ?? this.user;
        this.lists = snap.lists ?? [];
        this.tasks = snap.tasks ?? [];
      }
    } catch (e) {
      console.warn('Failed to load local data', e);
    }
    if (!this.lists.some((l) => l.isDefault)) {
      this.lists.unshift(buildList('Tasks', listColors[0], this.user.id, genId(), true));
      await this.persist();
    }
    useAppStore.setState({
      mode: 'local',
      authReady: true,
      dataReady: true,
      user: this.user,
      members: { [this.user.id]: this.user },
    });
    this.push();
  }

  private push(): void {
    useAppStore.setState({ lists: [...this.lists], tasks: [...this.tasks] });
  }

  private async persist(): Promise<void> {
    const snap: Snapshot = { user: this.user, lists: this.lists, tasks: this.tasks };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (e) {
      console.warn('Failed to save local data', e);
    }
  }

  private commit(): Promise<void> {
    this.push();
    return this.persist();
  }

  async createList(name: string, color: string): Promise<TaskList> {
    const list = buildList(name, color, this.user.id, genId());
    this.lists.push(list);
    await this.commit();
    return list;
  }

  async updateList(id: string, patch: Partial<TaskList>): Promise<void> {
    this.lists = this.lists.map((l) =>
      l.id === id ? { ...l, ...patch, updatedAt: Date.now() } : l
    );
    await this.commit();
  }

  async deleteList(id: string): Promise<void> {
    this.lists = this.lists.filter((l) => l.id !== id);
    this.tasks = this.tasks.filter((t) => t.listId !== id);
    await this.commit();
  }

  async createTask(draft: TaskDraft): Promise<Task> {
    const task = buildTask(draft, this.user.id, genId());
    this.tasks.push(task);
    await this.commit();
    return task;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<void> {
    this.tasks = this.tasks.map((t) =>
      t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t
    );
    await this.commit();
  }

  async deleteTask(id: string): Promise<void> {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    await this.commit();
  }

  async shareList(): Promise<string> {
    throw new Error(
      'Sharing needs cloud sync. Add your Firebase config to firebase.config.ts (see README) to share lists with friends.'
    );
  }

  async joinList(): Promise<string> {
    throw new Error(
      'Joining a list needs cloud sync. Add your Firebase config to firebase.config.ts (see README).'
    );
  }

  async leaveList(): Promise<void> {
    throw new Error('Not available in local mode.');
  }

  async signIn(): Promise<void> {
    throw new Error('Not available in local mode.');
  }

  async signUp(): Promise<void> {
    throw new Error('Not available in local mode.');
  }

  async signOutUser(): Promise<void> {
    throw new Error('Not available in local mode.');
  }

  private cloudOnly(): never {
    throw new Error(
      'Friends and chat need cloud sync. Add your Firebase config to firebase.config.ts (see README).'
    );
  }

  async signInWithGoogle(): Promise<void> {
    this.cloudOnly();
  }

  async addFriendByEmail(): Promise<void> {
    this.cloudOnly();
  }

  async respondToFriendRequest(): Promise<void> {
    this.cloudOnly();
  }

  async removeFriend(): Promise<void> {
    this.cloudOnly();
  }

  async inviteFriendToList(): Promise<void> {
    this.cloudOnly();
  }

  watchMessages(): () => void {
    return () => {};
  }

  async sendMessage(): Promise<void> {
    this.cloudOnly();
  }
}

export const localService = new LocalService();
