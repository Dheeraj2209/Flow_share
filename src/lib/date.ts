import { UserPrefs } from '@/types';

// Monday-based start of week using local timezone
export function startOfWeek(d: Date) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // Mon=0
  date.setDate(date.getDate() - diff);
  return date;
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Local date key YYYY-MM-DD
export function formatISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatLocalISODate(d: Date) {
  return formatISODate(d);
}

export function formatLocalYearMonth(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Produce YYYY-MM-DD for a given date in a specified IANA timezone (defaults to client's local tz)
export function dateKeyInZone(d: Date, timeZone?: string) {
  try {
    const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(d);
  } catch {
    return formatISODate(d);
  }
}

export function minutesToHHMM(mins: number) {
  const m = Math.max(0, Math.min(1435, Math.round(mins)));
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function hhmmToMinutes(hhmm: string) {
  const m = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return 0;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

export function nextWeekday(from: Date, wd: number) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const cur = d.getDay();
  const diff = (wd + 7 - cur) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

export function parseDueDate(due_date?: string | null, due_time?: string | null): Date | null {
  if (!due_date) return null;
  const time = due_time && /^\d{2}:\d{2}$/.test(due_time) ? due_time : '23:59';
  const d = new Date(`${due_date}T${time}:00`);
  return isNaN(d.getTime()) ? null : d;
}

export function isOverdueDate(d: Date | null): boolean {
  if (!d) return false;
  return Date.now() > d.getTime();
}

export function formatTimeLocal(d: Date, prefs: UserPrefs) {
  const h = d.getHours();
  const m = d.getMinutes();
  if (prefs.timeFormat === '12h') {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hh = ((h + 11) % 12) + 1;
    return `${String(hh)}:${String(m).padStart(2,'0')} ${ampm}`;
  }
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

export function formatDateLocal(d: Date, prefs: UserPrefs) {
  const today = new Date();
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (prefs.relativeDates) {
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 1 && diffDays < 7) {
      return d.toLocaleDateString(undefined, { weekday: 'short' });
    }
  }
  if (prefs.dateFormat === 'MM/DD') return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  if (prefs.dateFormat === 'DD/MM') return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
