import { Task } from '@/types';

export function hashToHsl(input: string | number, s = 60, l = 52) {
  const str = String(input);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} ${s}% ${l}%)`;
}

export function withAlpha(hsl: string, a: number) {
  return hsl.replace(/\)$/, ` / ${a})`);
}

export function statusColor(status: Task["status"]) {
  switch (status) {
    case "done": return "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-600/30";
    case "in_progress": return "bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-600/30";
    default: return "bg-sky-500/20 text-sky-800 dark:text-sky-200 border-sky-600/30";
  }
}

export function priorityClass(p?: number) {
  if (!p) return '';
  if (p >= 3) return 'bg-rose-500/15 text-rose-700 border-rose-600/30';
  if (p === 2) return 'bg-amber-500/15 text-amber-700 border-amber-600/30';
  return 'bg-sky-500/15 text-sky-800 border-sky-600/30';
}

