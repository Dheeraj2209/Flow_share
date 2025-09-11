import { Task, View } from '@/types';
import { addDays, startOfMonth, startOfWeek, formatISODate } from '@/lib/date';

export function expandWeekly(task: Task, rangeStart: Date, rangeEnd: Date) {
  const results: string[] = [];
  if (!task.byweekday) return results;
  const days: number[] = JSON.parse(task.byweekday || "[]");
  const interval = Math.max(1, task.interval || 1);
  let cur = startOfWeek(rangeStart);
  while (cur < rangeEnd) {
    for (const dw of days) {
      const d = addDays(cur, (dw + 7 - 1) % 7); // 0=Sun -> Mon-based
      if (d >= rangeStart && d < rangeEnd) results.push(formatISODate(d));
    }
    cur = addDays(cur, 7 * interval);
  }
  return Array.from(new Set(results)).sort();
}

export function expandTaskInstances(task: Task, view: View, anchor: Date) {
  const start = view === "day" ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()) : view === "week" ? startOfWeek(anchor) : startOfMonth(anchor);
  const end = view === "day" ? addDays(start, 1) : view === "week" ? addDays(start, 7) : new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const keyDate = (d: Date) => formatISODate(d);
  if (task.recurrence === "none") return [];
  if (task.recurrence === "daily") {
    const interval = Math.max(1, task.interval || 1);
    let cur = task.bucket_date ? new Date(task.bucket_date + "T00:00:00") : start;
    if (cur < start) {
      const diffDays = Math.floor((start.getTime() - cur.getTime()) / 86400000);
      const steps = Math.ceil(diffDays / interval);
      cur = addDays(cur, steps * interval);
    }
    const dates: string[] = [];
    const until = task.until ? new Date(task.until + "T00:00:00") : null;
    while (cur < end && (!until || cur <= until)) {
      dates.push(keyDate(cur));
      cur = addDays(cur, interval);
    }
    return dates;
  }
  if (task.recurrence === "weekly") return expandWeekly(task, start, end);
  if (task.recurrence === "monthly") {
    const interval = Math.max(1, task.interval || 1);
    const anchorDate = task.bucket_date ? new Date(task.bucket_date + "T00:00:00") : start;
    const day = anchorDate.getDate();
    let cur = new Date(start.getFullYear(), start.getMonth(), day);
    if (cur < start) cur = new Date(start.getFullYear(), start.getMonth() + 1, day);
    const until = task.until ? new Date(task.until + "T00:00:00") : null;
    const dates: string[] = [];
    while (cur < end && (!until || cur <= until)) {
      if (cur >= start) dates.push(keyDate(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth() + interval, day);
    }
    return dates;
  }
  return [];
}

