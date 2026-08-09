import type { ChatMessage, Task, TaskList } from '../types';

/** Everything needed to create a task; unspecified fields get sensible defaults. */
export type TaskDraft = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>> & {
  listId: string;
  title: string;
};

export interface DataService {
  init(): Promise<void>;
  createList(name: string, color: string): Promise<TaskList>;
  updateList(id: string, patch: Partial<TaskList>): Promise<void>;
  deleteList(id: string): Promise<void>;
  createTask(draft: TaskDraft): Promise<Task>;
  updateTask(id: string, patch: Partial<Task>): Promise<void>;
  deleteTask(id: string): Promise<void>;
  /** Returns the invite code for the list, creating one if needed. */
  shareList(listId: string): Promise<string>;
  /** Joins a list by invite code; returns the list id. */
  joinList(code: string): Promise<string>;
  /** Removes the current user from a shared list they don't own. */
  leaveList(listId: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  /** Google account-chooser sign-in (web only for now). */
  signInWithGoogle(): Promise<void>;
  signOutUser(): Promise<void>;
  /**
   * Sends a friend request. The email is hashed and matched against stored
   * email hashes — no email address is ever written to the database.
   */
  addFriendByEmail(email: string): Promise<void>;
  respondToFriendRequest(friendUid: string, accept: boolean): Promise<void>;
  removeFriend(friendUid: string): Promise<void>;
  /** Adds an accepted friend straight to a list's members. */
  inviteFriendToList(listId: string, friendUid: string): Promise<void>;
  /** Live-subscribes to a shared list's chat; returns an unsubscribe fn. */
  watchMessages(listId: string, onMessages: (messages: ChatMessage[]) => void): () => void;
  sendMessage(listId: string, text: string): Promise<void>;
}

export function buildTask(draft: TaskDraft, uid: string, id: string): Task {
  const now = Date.now();
  return {
    id,
    listId: draft.listId,
    title: draft.title,
    notes: draft.notes ?? '',
    completed: draft.completed ?? false,
    completedAt: draft.completedAt ?? null,
    important: draft.important ?? false,
    myDayDate: draft.myDayDate ?? null,
    dueDate: draft.dueDate ?? null,
    repeat: draft.repeat ?? null,
    someday: draft.someday ?? false,
    steps: draft.steps ?? [],
    assigneeId: draft.assigneeId ?? null,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildList(
  name: string,
  color: string,
  uid: string,
  id: string,
  isDefault = false
): TaskList {
  const now = Date.now();
  return {
    id,
    name,
    color,
    ownerId: uid,
    memberIds: [uid],
    shareCode: null,
    background: null,
    isDefault,
    createdAt: now,
    updatedAt: now,
  };
}
