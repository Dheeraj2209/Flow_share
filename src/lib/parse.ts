// @ts-expect-error - chrono-node lacks proper types in this ESM setup
import * as chrono from 'chrono-node';
import { Task, View } from '@/types';
import { formatISODate } from '@/lib/date';

export function parseQuickAdd(text: string, base: Date) {
  const result: { title: string; due_date?: string; due_time?: string; recurrence?: Task['recurrence']; byweekday?: number[]; interval?: number; color?: string; priority?: number; assignee?: string; scope?: View } = { title: text.trim() } as any;
  if (!text.trim()) return result;
  const parsed = chrono.parse(text, base);
  if (parsed && parsed[0]) {
    const p = parsed[0];
    const dt = p.start?.date?.() as Date | undefined;
    if (dt) {
      result.due_date = formatISODate(dt);
      if (p.start?.isCertain('hour')) {
        const hh = String(dt.getHours()).padStart(2, '0');
        const mm = String(dt.getMinutes()).padStart(2, '0');
        result.due_time = `${hh}:${mm}`;
      }
    }
  }
  const lower = text.toLowerCase();
  if (/(every|each)\s+day|\bdaily\b/.test(lower)) result.recurrence = 'daily';
  if (/(every|each)\s+week|\bweekly\b/.test(lower)) result.recurrence = 'weekly';
  if (/(every|each)\s+month|\bmonthly\b/.test(lower)) result.recurrence = 'monthly';
  const intervalMatch = lower.match(/every\s+(\d+)\s+(day|week|month)/);
  if (intervalMatch) result.interval = Math.max(1, parseInt(intervalMatch[1] || '1'));
  if (result.recurrence === 'weekly') {
    const days = ['sun','mon','tue','wed','thu','fri','sat'];
    const selected: number[] = [];
    days.forEach((d,i) => { if (new RegExp(`\\b${d}(?:day)?\\b`).test(lower)) selected.push(i); });
    if (selected.length) result.byweekday = selected;
    else if (result.due_date) {
      const dd = new Date(result.due_date + 'T00:00:00');
      result.byweekday = [dd.getDay()];
    }
  }
  const colorMap: Record<string,string> = { red:'#ef4444', orange:'#f97316', yellow:'#eab308', green:'#22c55e', teal:'#06b6d4', cyan:'#06b6d4', blue:'#3b82f6', indigo:'#6366f1', violet:'#8b5cf6', purple:'#8b5cf6', pink:'#ec4899' };
  const colorMatch = lower.match(/#(red|orange|yellow|green|teal|cyan|blue|indigo|violet|purple|pink)\b/);
  if (colorMatch) result.color = colorMap[colorMatch[1]];
  if (/#p?3\b|#high\b|!{2,}/.test(lower)) result.priority = 3;
  else if (/#p?2\b|#med\b|#medium\b|!{1}/.test(lower)) result.priority = 2;
  else if (/#p?1\b|#low\b/.test(lower)) result.priority = 1;
  const atMatch = text.match(/@([\p{L}\d_-]+)/u);
  if (atMatch) result.assignee = atMatch[1];
  const scopeMatch = lower.match(/#(day|week|month)\b/);
  if (scopeMatch) result.scope = scopeMatch[1] as View;
  return result;
}

