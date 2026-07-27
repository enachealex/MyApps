import type { SmartListId } from '../types';

export type RootStackParamList = {
  Home: undefined;
  List: { listId?: string; smart?: SmartListId };
  Task: { taskId: string };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
