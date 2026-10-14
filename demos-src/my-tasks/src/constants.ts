import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { SmartListId } from './types';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export interface SmartListMeta {
  id: SmartListId;
  name: string;
  icon: IconName;
  color: string;
  colorDark: string;
}

export const SMART_LISTS: Record<SmartListId, SmartListMeta> = {
  myday: { id: 'myday', name: 'My Day', icon: 'sunny-outline', color: '#5F5D58', colorDark: '#C8C6C4' },
  important: { id: 'important', name: 'Important', icon: 'star-outline', color: '#CC3F55', colorDark: '#E37D80' },
  planned: { id: 'planned', name: 'Planned', icon: 'calendar-outline', color: '#038387', colorDark: '#00B7C3' },
  assigned: { id: 'assigned', name: 'Assigned to me', icon: 'person-outline', color: '#498205', colorDark: '#6CCB5F' },
  someday: { id: 'someday', name: 'Someday', icon: 'file-tray-full-outline', color: '#8764B8', colorDark: '#B4A0FF' },
};

/** Soft cap for My Day — the "Stage" in the two-tier model. */
export const MY_DAY_SOFT_LIMIT = 5;

/** Accent color for a smart list under the active theme. */
export function smartColor(meta: SmartListMeta, dark: boolean): string {
  return dark ? meta.colorDark : meta.color;
}
