export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

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
