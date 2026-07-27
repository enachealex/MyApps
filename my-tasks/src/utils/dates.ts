import type { Repeat } from '../types';

/** Format a Date as a local YYYY-MM-DD string. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

/** Parse YYYY-MM-DD as local midnight. */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysStr(s: string, days: number): string {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function isOverdue(s: string): boolean {
  return s < todayStr();
}

export function formatDueDate(s: string): string {
  const today = todayStr();
  if (s === today) return 'Today';
  if (s === addDaysStr(today, 1)) return 'Tomorrow';
  if (s === addDaysStr(today, -1)) return 'Yesterday';
  const d = parseDateStr(s);
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export function formatLongDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Next due date for a repeating task, advanced from `from` (YYYY-MM-DD). */
export function nextOccurrence(from: string, repeat: Repeat): string {
  const d = parseDateStr(from);
  switch (repeat) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekdays':
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly': {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, lastDay));
      break;
    }
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return toDateStr(d);
}

export const REPEAT_LABELS: Record<Repeat, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};
