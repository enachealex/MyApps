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

/** True for `after:N` rules, whose next date is based on the completion day. */
export function isAfterCompletion(repeat: Repeat): boolean {
  return repeat.startsWith('after:');
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS = ['', '1st', '2nd', '3rd', '4th'];

/** The W-th weekday D of a given month (week 1-4). */
function nthWeekdayOfMonth(year: number, month: number, week: number, weekday: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (week - 1) * 7);
}

/** Encodes "monthly on the Nth weekday" derived from a reference date. */
export function monthWeekdayRuleFor(dateStr: string): Repeat {
  const d = parseDateStr(dateStr);
  const week = Math.min(4, Math.ceil(d.getDate() / 7));
  return `monthweekday:${week}:${d.getDay()}` as Repeat;
}

/** Next due date for a repeating task, advanced from `from` (YYYY-MM-DD). */
export function nextOccurrence(from: string, repeat: Repeat): string {
  if (repeat.startsWith('after:')) {
    const days = Math.max(1, Number(repeat.slice(6)) || 1);
    return addDaysStr(from, days);
  }
  if (repeat.startsWith('monthweekday:')) {
    const [, weekRaw, weekdayRaw] = repeat.split(':');
    const week = Math.min(4, Math.max(1, Number(weekRaw) || 1));
    const weekday = Math.min(6, Math.max(0, Number(weekdayRaw) || 0));
    const d = parseDateStr(from);
    let candidate = nthWeekdayOfMonth(d.getFullYear(), d.getMonth(), week, weekday);
    if (candidate <= d) {
      candidate = nthWeekdayOfMonth(d.getFullYear(), d.getMonth() + 1, week, weekday);
    }
    return toDateStr(candidate);
  }
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

export function repeatLabel(repeat: Repeat): string {
  if (repeat.startsWith('after:')) {
    const days = Number(repeat.slice(6)) || 1;
    if (days === 7) return '1 week after completion';
    if (days === 30) return '1 month after completion';
    return `${days} day${days === 1 ? '' : 's'} after completion`;
  }
  if (repeat.startsWith('monthweekday:')) {
    const [, weekRaw, weekdayRaw] = repeat.split(':');
    const week = Math.min(4, Math.max(1, Number(weekRaw) || 1));
    const weekday = Math.min(6, Math.max(0, Number(weekdayRaw) || 0));
    return `Monthly on the ${ORDINALS[week]} ${WEEKDAY_NAMES[weekday]}`;
  }
  switch (repeat) {
    case 'daily':
      return 'Daily';
    case 'weekdays':
      return 'Weekdays';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'yearly':
      return 'Yearly';
    default:
      return 'Repeat';
  }
}
