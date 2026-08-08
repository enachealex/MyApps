export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export type FriendStatus = 'incoming' | 'outgoing' | 'accepted';

export interface FriendEntry {
  uid: string;
  name: string;
  status: FriendStatus;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  listId: string;
  authorId: string;
  text: string;
  createdAt: number;
}

export type SmartListId = 'myday' | 'important' | 'planned' | 'assigned';

export interface TaskStep {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  listId: string;
  title: string;
  notes: string;
  completed: boolean;
  completedAt: number | null;
  important: boolean;
  /** YYYY-MM-DD of the day this task was added to My Day (My Day resets daily). */
  myDayDate: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  repeat: Repeat | null;
  steps: TaskStep[];
  assigneeId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskList {
  id: string;
  name: string;
  color: string;
  ownerId: string;
  memberIds: string[];
  shareCode: string | null;
  /** Decorative background id from src/backgrounds.ts, or null for plain. */
  background?: string | null;
  /** The built-in "Tasks" list. Cannot be deleted or renamed. */
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string | null;
}
