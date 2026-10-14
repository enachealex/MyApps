import type { ChatMessage, Task, TaskList, TaskSection, UserProfile } from '../types';
import { listColors } from '../theme';
import { genId } from '../utils/id';
import { addDaysStr, todayStr } from '../utils/dates';
import { buildList, buildTask, DataService, TaskDraft } from './service';
import { useAppStore } from './store';

/**
 * DEMO BUILD — in-memory only.
 *
 * This replaces the normal on-device service for the public demo. The
 * differences from the real app are deliberate:
 *
 *   • Nothing is read from or written to storage. No AsyncStorage, no
 *     localStorage, no IndexedDB. Everything lives in the fields below, in
 *     this browser tab, and is gone on reload.
 *   • No network of any kind. Firebase is not configured in this build, so
 *     nothing can reach a server even by accident.
 *   • Accounts, sharing, friends and chat are switched off rather than merely
 *     unconfigured — a demo visitor has no account and cannot invite, message
 *     or reach another person.
 *
 * The result: a visitor can use the app freely, and nothing they type ever
 * leaves their own browser.
 */

function demoNotAvailable(): never {
  throw new Error(
    'This is a demo — accounts, sharing, friends and chat are turned off. ' +
      'Open the full app to use them.'
  );
}

class DemoLocalService implements DataService {
  private user: UserProfile = { id: 'demo-user', name: 'You', email: null };
  private lists: TaskList[] = [];
  private tasks: Task[] = [];

  async init(): Promise<void> {
    this.seed();
    useAppStore.setState({
      mode: 'local',
      authReady: true,
      dataReady: true,
      user: this.user,
      members: { [this.user.id]: this.user },
    });
    this.push();
  }

  /**
   * Sample content for the demo.
   *
   * This is a showcase, not filler: between them these tasks exercise My Day,
   * Important, Planned (overdue / today / upcoming) and Someday, plus steps,
   * lockstep steps, notes, repeats, task dependencies, list sections (which
   * are also the Kanban columns) and a list background. A visitor should be
   * able to see what the app does without adding anything themselves.
   */
  private seed(): void {
    const uid = this.user.id;
    const today = todayStr();
    const day = (n: number) => addDaysStr(today, n);

    // Sections double as Kanban columns on the board view.
    const produce: TaskSection = { id: genId(), name: 'Produce', order: 0 };
    const bakery: TaskSection  = { id: genId(), name: 'Bakery',  order: 1 };
    const pantry: TaskSection  = { id: genId(), name: 'Pantry',  order: 2 };

    const tasksList = buildList('Tasks', listColors[0], uid, genId(), true);
    const groceries = buildList('Groceries', listColors[4], uid, genId());
    const project   = buildList('Weekend project', listColors[2], uid, genId());

    groceries.sections = [produce, bakery, pantry];
    project.background = 'forest';          // decorative background, see backgrounds.ts

    this.lists = [tasksList, groceries, project];

    // Pre-mint the ids the dependency chain needs to point at.
    const buyPartsId = genId();
    const fixTyreId  = genId();

    const add = (draft: TaskDraft, id: string = genId()) => {
      this.tasks.push(buildTask(draft, uid, id));
    };

    /* ── Tasks: the everyday list ─────────────────────────────────────── */
    add({
      listId: tasksList.id,
      title: 'Tap the circle to finish a task',
      myDayDate: today,
      important: true,
    });
    add({
      listId: tasksList.id,
      title: 'Renew the car registration',
      dueDate: day(-2),                     // overdue, so Planned shows the red state
      important: true,
    });
    add({
      listId: tasksList.id,
      title: 'Water the plants',
      myDayDate: today,
      dueDate: today,
      repeat: 'weekly',
    });
    add({
      listId: tasksList.id,
      title: 'Plan the trip',
      notes: 'Aiming for the first week of next month. Flights first — the rest is flexible.',
      dueDate: day(6),
      stepsInOrder: true,                   // lockstep: steps complete top to bottom
      steps: [
        { id: genId(), title: 'Pick the dates',      completed: true },
        { id: genId(), title: 'Book the flights',    completed: true },
        { id: genId(), title: 'Book somewhere to stay', completed: false },
        { id: genId(), title: 'Make a packing list', completed: false },
      ],
    });
    add({
      listId: tasksList.id,
      title: 'Pay the electric bill',
      dueDate: day(4),
      repeat: 'monthly',
    });
    add({
      listId: tasksList.id,
      title: 'Book the dentist',
      completed: true,
      completedAt: Date.now() - 3600_000,
    });
    // Parked: visible in Someday, out of the way everywhere else.
    add({ listId: tasksList.id, title: 'Learn to make sourdough', someday: true });
    add({ listId: tasksList.id, title: 'Repaint the shed',        someday: true });

    /* ── Groceries: grouped into sections / Kanban columns ────────────── */
    add({ listId: groceries.id, title: 'Apples',    sectionId: produce.id });
    add({ listId: groceries.id, title: 'Spinach',   sectionId: produce.id });
    add({ listId: groceries.id, title: 'Sourdough loaf', sectionId: bakery.id, important: true });
    add({ listId: groceries.id, title: 'Olive oil', sectionId: pantry.id });
    add({
      listId: groceries.id,
      title: 'Coffee',
      sectionId: pantry.id,
      completed: true,
      completedAt: Date.now() - 7200_000,
    });

    /* ── Weekend project: a dependency chain ──────────────────────────── */
    add({ listId: project.id, title: 'Buy the parts', dueDate: day(1) }, buyPartsId);
    add({
      listId: project.id,
      title: 'Fix the bike tyre',
      blockedBy: buyPartsId,                // stays blocked until the parts arrive
    }, fixTyreId);
    add({
      listId: project.id,
      title: 'Take it for a ride',
      blockedBy: fixTyreId,
      myDayDate: today,
    });
    add({
      listId: project.id,
      title: 'Mini golf with friends',
      dueDate: day(2),
      repeat: 'after:14',                   // 14 days after it is completed
    });
  }

  private push(): void {
    useAppStore.setState({ lists: [...this.lists], tasks: [...this.tasks] });
  }

  /** DEMO BUILD — persistence is intentionally a no-op. */
  private commit(): Promise<void> {
    this.push();
    return Promise.resolve();
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

  /* ── Everything below reaches other people, so it is off in the demo ── */

  async shareList(): Promise<string> {
    demoNotAvailable();
  }

  async joinList(): Promise<string> {
    demoNotAvailable();
  }

  async leaveList(): Promise<void> {
    demoNotAvailable();
  }

  async signIn(): Promise<void> {
    demoNotAvailable();
  }

  async signUp(): Promise<void> {
    demoNotAvailable();
  }

  async signInWithGoogle(): Promise<void> {
    demoNotAvailable();
  }

  async signOutUser(): Promise<void> {
    demoNotAvailable();
  }

  async addFriendByEmail(): Promise<void> {
    demoNotAvailable();
  }

  async respondToFriendRequest(): Promise<void> {
    demoNotAvailable();
  }

  async removeFriend(): Promise<void> {
    demoNotAvailable();
  }

  async inviteFriendToList(): Promise<void> {
    demoNotAvailable();
  }

  watchMessages(_listId: string, onMessages: (messages: ChatMessage[]) => void): () => void {
    onMessages([]);
    return () => {};
  }

  async sendMessage(): Promise<void> {
    demoNotAvailable();
  }
}

export const localService = new DemoLocalService();
