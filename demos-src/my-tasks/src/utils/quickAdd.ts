import * as chrono from 'chrono-node';
import { toDateStr } from './dates';

export interface QuickAddParse {
  /** Input with the date fragment and priority marker stripped out. */
  title: string;
  dueDate: string | null;
  important: boolean;
  /** The natural-language fragment that produced the date (for the hint chip). */
  dateText: string | null;
}

/**
 * Natural-language quick add: "Call dentist next Tuesday at 3pm !" becomes
 * title "Call dentist", a due date, and the important flag — no pickers.
 */
export function parseQuickAdd(raw: string): QuickAddParse {
  let text = raw;

  const important = /(^|\s)!+(\s|$)/.test(text);
  if (important) text = text.replace(/(^|\s)!+(?=\s|$)/g, ' ');

  let dueDate: string | null = null;
  let dateText: string | null = null;
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  if (results.length > 0) {
    const r = results[0];
    dueDate = toDateStr(r.start.date());
    dateText = r.text;
    text = text.slice(0, r.index) + text.slice(r.index + r.text.length);
    // Tidy connectives left dangling by the removal ("Call dentist on").
    text = text.replace(/\s+(on|at|by|due|for)\s*$/i, '').replace(/^\s*(on|at|by|due|for)\s+/i, '');
  }

  const title = text.replace(/\s+/g, ' ').trim();
  return {
    title: title || raw.replace(/\s+/g, ' ').trim(),
    dueDate,
    important,
    dateText,
  };
}
