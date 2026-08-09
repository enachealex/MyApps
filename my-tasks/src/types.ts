/**
 * Repetition rule, stored as a string for backend compatibility:
 * - the five basics ('daily' … 'yearly')
 * - `after:N` — due N days after the task is completed (a delayed task never
 *   stacks up overdue occurrences)
 * - `monthweekday:W:D` — the W-th (1-4) weekday D (0=Sun) of every month,
 *   e.g. `monthweekday:1:1` = every 1st Monday
 */
export type Repeat =
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | `after:${number}`
  | `monthweekday:${number}:${number}`;

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

export type SmartListId = 'myday' | 'important' | 'planned' | 'assigned' | 'someday';

export interface TaskStep {
  id: string;
  title: string;
  completed: boolean;
}

export interface TaskSection {
  id: string;
  name: string;
  order: number;
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
  /** Parked in the Someday list: out of every active view, never lost. */
  someday?: boolean;
  /** Section within the list; unknown/absent ids render as unsectioned. */
  sectionId?: string | null;
  /** Manual sort key (ascending). Falls back to -createdAt (newest first). */
  order?: number;
  /** Lockstep mode: steps can only be completed top to bottom. */
  stepsInOrder?: boolean;
  /** Task in the same list that must be completed before this one. */
  blockedBy?: string | null;
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
  /** Sections tasks can be grouped into (also the Kanban columns). */
  sections?: TaskSection[];
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
