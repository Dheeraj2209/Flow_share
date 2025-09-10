"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
// @ts-ignore - chrono-node has no ESM types here in this setup
import * as chrono from 'chrono-node';
import { Calendar, Check, ChevronLeft, ChevronRight, ListPlus, Plus, Share2, UserPlus, Users, Repeat, Clock, Trash2, Pencil, User, ChevronDown, Hash, Settings2, GripVertical, BookOpen } from "lucide-react";

type Person = {
  id: number;
  name: string;
  email?: string | null;
  color?: string | null;
};

type Task = {
  id: number;
  title: string;
  description?: string | null;
  person_id?: number | null;
  status: "todo" | "in_progress" | "done";
  due_date?: string | null;
  due_time?: string | null;
  bucket_type?: "day" | "week" | "month" | null;
  bucket_date?: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  interval: number;
  byweekday?: string | null; // JSON array
  until?: string | null;
  sort?: number;
  color?: string | null;
  priority?: number; // 0 none, 1 low, 2 med, 3 high
};

type ExternalSource = {
  id: number;
  person_id: number;
  provider: string;
  url?: string | null;
};

type View = "day" | "week" | "month";

type UserPrefs = {
  relativeDates: boolean;
  timeFormat: '12h' | '24h';
  dateFormat: 'YYYY-MM-DD' | 'MM/DD' | 'DD/MM';
};

function startOfWeek(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay();
  const diff = (day + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - diff);
  return date;
}

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function formatISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function minutesToHHMM(mins: number) {
  const m = Math.max(0, Math.min(1435, Math.round(mins)));
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function hhmmToMinutes(hhmm: string) {
  const m = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return 0;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

function nextWeekday(from: Date, wd: number) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const cur = d.getUTCDay();
  const diff = (wd + 7 - cur) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function parseQuickAdd(text: string, base: Date) {
  const result: { title: string; due_date?: string; due_time?: string; recurrence?: Task['recurrence']; byweekday?: number[]; interval?: number; color?: string; priority?: number; assignee?: string; scope?: View } = { title: text.trim() };
  if (!text.trim()) return result;
  // Use chrono to find date/time
  const parsed = chrono.parse(text, base);
  if (parsed && parsed[0]) {
    const p = parsed[0];
    const dt = p.start?.date?.() as Date | undefined;
    if (dt) {
      result.due_date = formatISODate(new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate())));
      if (p.start?.isCertain('hour')) {
        const hh = String(dt.getHours()).padStart(2, '0');
        const mm = String(dt.getMinutes()).padStart(2, '0');
        result.due_time = `${hh}:${mm}`;
      }
    }
  }
  // Recurrence detection
  const lower = text.toLowerCase();
  if (/(every|each)\s+day|\bdaily\b/.test(lower)) result.recurrence = 'daily';
  if (/(every|each)\s+week|\bweekly\b/.test(lower)) result.recurrence = 'weekly';
  if (/(every|each)\s+month|\bmonthly\b/.test(lower)) result.recurrence = 'monthly';
  const intervalMatch = lower.match(/every\s+(\d+)\s+(day|week|month)/);
  if (intervalMatch) result.interval = Math.max(1, parseInt(intervalMatch[1] || '1'));
  // Weekday parsing for weekly patterns
  if (result.recurrence === 'weekly') {
    const days = ['sun','mon','tue','wed','thu','fri','sat'];
    const selected: number[] = [];
    days.forEach((d,i) => { if (new RegExp(`\\b${d}(?:day)?\\b`).test(lower)) selected.push(i); });
    if (selected.length) result.byweekday = selected;
    else if (result.due_date) {
      const dd = new Date(result.due_date + 'T00:00:00.000Z');
      result.byweekday = [dd.getUTCDay()];
    }
  }
  // Color and priority and assignee
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

function hashToHsl(input: string | number, s = 60, l = 52) {
  const str = String(input);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} ${s}% ${l}%)`;
}

function statusColor(status: Task["status"]) {
  switch (status) {
    case "done": return "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-600/30";
    case "in_progress": return "bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-600/30";
    default: return "bg-sky-500/20 text-sky-800 dark:text-sky-200 border-sky-600/30";
  }
}

function withAlpha(hsl: string, a: number) {
  return hsl.replace(/\)$/, ` / ${a})`);
}

function priorityClass(p?: number) {
  if (!p) return '';
  if (p >= 3) return 'bg-rose-500/15 text-rose-700 border-rose-600/30';
  if (p === 2) return 'bg-amber-500/15 text-amber-700 border-amber-600/30';
  return 'bg-sky-500/15 text-sky-800 border-sky-600/30';
}

function parseDueDate(task: Task): Date | null {
  if (!task.due_date) return null;
  const time = task.due_time && /^\d{2}:\d{2}$/.test(task.due_time) ? task.due_time : '23:59';
  // Treat due date/time as UTC for consistency
  const iso = `${task.due_date}T${time}:00.000Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function isOverdue(task: Task): boolean {
  if (task.status === 'done') return false;
  const d = parseDueDate(task);
  if (!d) return false;
  return Date.now() > d.getTime();
}

function formatTimeLocal(d: Date, prefs: UserPrefs) {
  const h = d.getHours();
  const m = d.getMinutes();
  if (prefs.timeFormat === '12h') {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hh = ((h + 11) % 12) + 1;
    return `${String(hh)}:${String(m).padStart(2,'0')} ${ampm}`;
  }
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function formatDateLocal(d: Date, prefs: UserPrefs) {
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

function formatDueLabel(task: Task, prefs: UserPrefs) {
  if (!task.due_date && !task.due_time) return '';
  // Build local date for display
  const dateStr = task.due_date || '';
  const timeStr = task.due_time && /^\d{2}:\d{2}$/.test(task.due_time) ? task.due_time : undefined;
  const local = dateStr ? new Date(`${dateStr}T${timeStr || '00:00'}:00`) : new Date();
  const datePart = dateStr ? formatDateLocal(local, prefs) : '';
  const timePart = timeStr ? formatTimeLocal(local, prefs) : '';
  return `${datePart}${datePart && timePart ? ' ' : ''}${timePart}`;
}

function expandWeekly(task: Task, rangeStart: Date, rangeEnd: Date) {
  const results: string[] = [];
  if (!task.byweekday) return results;
  const days: number[] = JSON.parse(task.byweekday || "[]");
  const interval = Math.max(1, task.interval || 1);
  // Find first week anchor
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

function expandTaskInstances(task: Task, view: View, anchor: Date) {
  const start = view === "day" ? anchor : view === "week" ? startOfWeek(anchor) : startOfMonth(anchor);
  const end = view === "day" ? addDays(start, 1) : view === "week" ? addDays(start, 7) : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const keyDate = (d: Date) => formatISODate(d);
  if (task.recurrence === "none") {
    // Single instance falls into bucket match
    if (task.bucket_type === view) {
      const t = task.bucket_date;
      if (t) {
        const td = new Date(t + "T00:00:00.000Z");
        if (td >= start && td < end) return [keyDate(td)];
      }
    }
    return [];
  }

  if (task.recurrence === "daily") {
    const interval = Math.max(1, task.interval || 1);
    // Start from either bucket_date or start
    let cur = task.bucket_date ? new Date(task.bucket_date + "T00:00:00.000Z") : start;
    // Move cur to >= start
    if (cur < start) {
      const diffDays = Math.floor((start.getTime() - cur.getTime()) / 86400000);
      const steps = Math.ceil(diffDays / interval);
      cur = addDays(cur, steps * interval);
    }
    const dates: string[] = [];
    const until = task.until ? new Date(task.until + "T00:00:00.000Z") : null;
    while (cur < end && (!until || cur <= until)) {
      dates.push(keyDate(cur));
      cur = addDays(cur, interval);
    }
    return dates;
  }

  if (task.recurrence === "weekly") {
    return expandWeekly(task, start, end);
  }

  if (task.recurrence === "monthly") {
    // Occurs on the same day number each month starting from bucket_date
    const interval = Math.max(1, task.interval || 1);
    const anchorDate = task.bucket_date ? new Date(task.bucket_date + "T00:00:00.000Z") : start;
    const day = anchorDate.getUTCDate();
    let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day));
    if (cur < start) cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day));
    const until = task.until ? new Date(task.until + "T00:00:00.000Z") : null;
    const dates: string[] = [];
    while (cur < end && (!until || cur <= until)) {
      if (cur >= start) dates.push(keyDate(cur));
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + interval, day));
    }
    return dates;
  }
  return [];
}

// realtime updates handled inline with incremental SSE handlers

export default function Home() {
  const [people, setPeople] = useState<Person[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<number | null>(null);
  const [view, setView] = useState<View>("week");
  const [layout, setLayout] = useState<'list'|'grid'|'timeline'>('list');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(288);
  const [isMobile, setIsMobile] = useState(false);
  const [sources, setSources] = useState<ExternalSource[]>([]);
  const [showConnect, setShowConnect] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState<string>('');
  const [personDetailsOpen, setPersonDetailsOpen] = useState(true);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<UserPrefs>({ relativeDates: true, timeFormat: '24h', dateFormat: 'YYYY-MM-DD' });

  useEffect(() => {
    try {
      const w = localStorage.getItem('sidebarWidth');
      if (w) setSidebarWidth(parseInt(w));
      const o = localStorage.getItem('sidebarOpen');
      if (o) setSidebarOpen(o === '1');
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('sidebarWidth', String(sidebarWidth)); } catch {}
  }, [sidebarWidth]);
  useEffect(() => {
    try { localStorage.setItem('sidebarOpen', sidebarOpen ? '1' : '0'); } catch {}
  }, [sidebarOpen]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('flow_prefs');
      if (raw) {
        const p = JSON.parse(raw);
        setPrefs((prev) => ({ ...prev, ...p }));
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('flow_prefs', JSON.stringify(prefs)); } catch {}
  }, [prefs]);
  useEffect(() => {
    try {
      const v = localStorage.getItem('personDetailsOpen');
      if (v != null) setPersonDetailsOpen(v === '1');
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('personDetailsOpen', personDetailsOpen ? '1' : '0'); } catch {}
  }, [personDetailsOpen]);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const anchorLabel = useMemo(() => {
    const d = anchor;
    if (view === "day") return d.toISOString().slice(0, 10);
    if (view === "week") {
      const s = startOfWeek(d);
      const e = addDays(s, 6);
      return `${s.toISOString().slice(0, 10)} → ${e.toISOString().slice(0, 10)}`;
    }
    const s = startOfMonth(d);
    const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
    return `${s.toISOString().slice(0, 10)} (${e.getUTCDate()} days)`;
  }, [anchor, view]);

  const refresh = useRef(0);
  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, tRes] = await Promise.all([
        fetch('/api/people').then(r => r.json()),
        fetch('/api/tasks').then(r => r.json()),
      ]);
      setPeople(pRes.people || []);
      setTasks(tRes.tasks || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
      refresh.current++;
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);
  useEffect(() => {
    // fetch sources for selected person
    if (selectedPerson != null) {
      fetch(`/api/sources?personId=${selectedPerson}`).then(r=>r.json()).then(d=> setSources(d.sources||[])).catch(()=>setSources([]));
    }
  }, [selectedPerson]);

  const [connected, setConnected] = useState(false);
  useEffect(() => {
    (window as any).currentMultiSelection = Array.from(selected);
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected.size) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const delta = (e.key === 'ArrowUp' ? -1 : 1) * (e.altKey ? 5 : 15);
        const ids = Array.from(selected);
        // optimistic update
        setTasks(prev => prev.map(t => {
          if (!ids.includes(t.id)) return t;
          if (t.bucket_type !== 'day') return t;
          const mins = hhmmToMinutes(t.due_time || '09:00') + delta;
          const clamped = Math.max(0, Math.min(1435, mins));
          return { ...t, due_time: minutesToHHMM(clamped) };
        }));
        // persist
        (async () => {
          for (const id of ids) {
            const t = tasks.find(x => x.id===id);
            if (!t || t.bucket_type !== 'day') continue;
            const mins = hhmmToMinutes((t.due_time || '09:00')) + delta;
            const clamped = Math.max(0, Math.min(1435, mins));
            await fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_time: minutesToHHMM(clamped) }) });
          }
        })();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, tasks]);
  useEffect(() => {
    // SSE with incremental updates for low-latency sync
    const src = new EventSource("/api/stream");
    const onOpen = () => setConnected(true);
    const onError = () => setConnected(false);
    const onPing = () => setConnected(true);
    const onTaskCreated = (e: MessageEvent) => {
      try {
        const { task } = JSON.parse(e.data);
        setTasks(prev => prev.some(t => t.id === task.id) ? prev : [task, ...prev]);
      } catch {}
    };
    const onTaskUpdated = (e: MessageEvent) => {
      try {
        const { task } = JSON.parse(e.data);
        setTasks(prev => prev.map(t => t.id === task.id ? task : t));
      } catch {}
    };
    const onTaskDeleted = (e: MessageEvent) => {
      try {
        const { id } = JSON.parse(e.data);
        setTasks(prev => prev.filter(t => t.id !== id));
      } catch {}
    };
    const onPeopleUpdated = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'created') setPeople(prev => prev.some(p => p.id === payload.person.id) ? prev : [...prev, payload.person]);
        else if (payload.type === 'updated') setPeople(prev => prev.map(p => p.id === payload.person.id ? payload.person : p));
        else if (payload.type === 'deleted') setPeople(prev => prev.filter(p => p.id !== payload.id));
      } catch {}
    };
    src.addEventListener('open', onOpen);
    src.addEventListener('error', onError);
    src.addEventListener('ping', onPing as any);
    src.addEventListener('task_created', onTaskCreated as any);
    src.addEventListener('task_updated', onTaskUpdated as any);
    src.addEventListener('task_deleted', onTaskDeleted as any);
    src.addEventListener('people_updated', onPeopleUpdated as any);
    return () => src.close();
  }, []);

  const grouped = useMemo(() => {
    // Build keys for the current view
    const map = new Map<string, Task[]>();
    const start = view === 'day' ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()))
      : view === 'week' ? startOfWeek(anchor)
      : startOfMonth(anchor);
    const end = view === 'day' ? addDays(start, 1)
      : view === 'week' ? addDays(start, 7)
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

    const relevant = tasks.filter(t => selectedPerson ? (t.person_id === selectedPerson) : true);
    const push = (dateKey: string, task: Task) => {
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(task);
    };
    for (const t of relevant) {
      if (t.recurrence === 'none') {
        // Always include day-level tasks in wider views
        if (t.bucket_type === 'day' && t.bucket_date) {
          const dt = new Date(t.bucket_date + 'T00:00:00.000Z');
          if (dt >= start && dt < end) push(t.bucket_date, t);
          continue;
        }
        // Include week-level tasks when viewing month (anchor on week start)
        if (view === 'month' && t.bucket_type === 'week' && t.bucket_date) {
          const dt = new Date(t.bucket_date + 'T00:00:00.000Z');
          if (dt >= start && dt < end) push(t.bucket_date, t);
          continue;
        }
        // Include tasks anchored to the current view period
        if (t.bucket_type === view && t.bucket_date) {
          const dt = new Date(t.bucket_date + 'T00:00:00.000Z');
          if (dt >= start && dt < end) push(t.bucket_date, t);
        }
        continue;
      }
      // Recurring: expand to dates
      for (const date of expandTaskInstances(t, view, anchor)) push(date, t);
    }
    // Sort tasks inside each day by 'sort' (if present), then status then title
    for (const [k, arr] of map) {
      arr.sort((a, b) => {
        const sa = a.sort ?? 0, sb = b.sort ?? 0;
        if (sa !== sb) return sa - sb;
        if (a.status !== b.status) return a.status > b.status ? 1 : -1;
        return a.title.localeCompare(b.title);
      });
    }
    return {
      start,
      end,
      days: Array.from(map.entries()).sort((a,b) => a[0].localeCompare(b[0]))
    };
  }, [tasks, selectedPerson, view, anchor, refresh.current]);

  const personColorMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of people) m.set(p.id, (p.color || hashToHsl(p.id)));
    return m;
  }, [people]);
  const personById = useMemo(() => new Map(people.map(p => [p.id, p] as const)), [people]);
  const activePersonColor = useMemo(() => selectedPerson ? (personColorMap.get(selectedPerson) || hashToHsl(selectedPerson)) : undefined, [selectedPerson, personColorMap]);
  const accentFor = (t: Task) => {
    if (t.color) return t.color;
    if (t.person_id != null) return personColorMap.get(t.person_id) || hashToHsl(t.person_id);
    return hashToHsl(t.id);
  };

  // Progress maps for current view window (unique tasks in range)
  const progressAll = useMemo(() => {
    const ids = new Set<number>();
    for (const [, items] of grouped.days) for (const t of items) ids.add(t.id);
    let done = 0, total = 0;
    for (const t of tasks) if (ids.has(t.id)) { total++; if (t.status === 'done') done++; }
    return { done, total };
  }, [grouped, tasks]);

  const progressByPerson = useMemo(() => {
    const idsByPerson = new Map<number, Set<number>>();
    for (const [, items] of grouped.days) for (const t of items) if (t.person_id != null) {
      if (!idsByPerson.has(t.person_id)) idsByPerson.set(t.person_id, new Set());
      idsByPerson.get(t.person_id)!.add(t.id);
    }
    const map = new Map<number, {done:number,total:number}>();
    for (const [pid, ids] of idsByPerson) {
      let done = 0, total = 0;
      for (const t of tasks) if (ids.has(t.id)) { total++; if (t.status === 'done') done++; }
      map.set(pid, { done, total });
    }
    return map;
  }, [grouped, tasks]);

  async function addPerson(formData: FormData) {
    const name = String(formData.get('name') || '').trim();
    if (!name) return;
    const res = await fetch('/api/people', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    try {
      const data = await res.json();
      if (data?.person) setPeople(prev => prev.some(p=>p.id===data.person.id) ? prev : [...prev, data.person]);
    } catch {}
    (document.getElementById('name') as HTMLInputElement).value = '';
  }

  // task creation moved to the bottom Composer

  async function toggleDone(task: Task) {
    const status = task.status === 'done' ? 'todo' : 'done';
    // optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
    fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }).catch(()=>{
      // fallback re-fetch if needed
      fetchAll();
    });
  }

  async function deleteTask(task: Task) {
    if (!confirm('Delete task?')) return;
    // optimistic
    setTasks(prev => prev.filter(t => t.id !== task.id));
    fetch(`/api/tasks/${task.id}`, { method: 'DELETE' }).catch(()=>{
      fetchAll();
    });
  }

  async function onReorderDay(dateKey: string, reordered: Task[]) {
    // Persist sort only for day-level tasks matching this dateKey
    // Compute minimal set of updates
    const updates: { id: number; sort: number }[] = [];
    let idx = 0;
    for (const t of reordered) {
      // Keep original order for non-day tasks
      if (t.bucket_type === 'day' && t.bucket_date === dateKey) {
        const current = t.sort ?? 0;
        if (current !== idx) updates.push({ id: t.id, sort: idx });
        t.sort = idx;
        idx++;
      }
    }
    // Optimistic update: apply new ordering in state
    setTasks(prev => {
      const map = new Map(prev.map(p => [p.id, p] as const));
      for (const t of reordered) {
        map.set(t.id, { ...map.get(t.id)!, sort: t.sort });
      }
      return Array.from(map.values());
    });
    // Persist sequentially
    for (const u of updates) {
      await fetch(`/api/tasks/${u.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort: u.sort }) });
    }
  }

  function changeAnchor(delta: number) {
    if (view === 'day') setAnchor(addDays(anchor, delta));
    else if (view === 'week') setAnchor(addDays(anchor, delta * 7));
    else setAnchor(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + delta, anchor.getUTCDate())));
  }

  const leftOffset = (!sidebarOpen || isMobile) ? 0 : sidebarWidth;
  return (
    <div className={`min-h-screen flex ${(!sidebarOpen || isMobile) ? 'flex-col' : 'md:flex-row'} text-sm`}>
      {/* Sidebar */}
      <aside className="relative border-b md:border-b-0 md:border-r border-black/10 dark:border-white/10 p-4 space-y-4" style={{ width: (isMobile || !sidebarOpen) ? '100%' : sidebarWidth }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <div className="size-8 rounded-lg bg-black text-white dark:bg-white dark:text-black grid place-items-center">
              <ListPlus size={18} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight flex items-center gap-1 truncate">Flowshare
              <span className={`size-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} title={connected ? 'Live' : 'Reconnecting'}></span>
            </h1>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button className="icon-btn" title={sidebarOpen? 'Collapse':'Expand'} onClick={()=> setSidebarOpen(o=>!o)}>{sidebarOpen ? '⟨' : '⟩'}</button>
            <a className="icon-btn" title="Tutorial" href="/tutorial"><BookOpen size={16} /></a>
            <button className="icon-btn" title="Preferences" onClick={()=> setPrefsOpen(v=>!v)}><Settings2 size={16} /></button>
            <button className="icon-btn" title="Share"><Share2 size={16} /></button>
          </div>
        </div>
        {prefsOpen && (
          <div className="popover mt-2">
            <div className="text-sm font-medium mb-2">Preferences</div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-xs opacity-70">Relative dates</label>
              <input type="checkbox" checked={prefs.relativeDates} onChange={e=> setPrefs(prev => ({ ...prev, relativeDates: e.target.checked }))} />
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-xs opacity-70">Time format</label>
              <select className="border rounded-md px-2 py-1 text-sm" value={prefs.timeFormat} onChange={e=> setPrefs(prev => ({ ...prev, timeFormat: e.target.value as any }))}>
                <option value="24h">24h</option>
                <option value="12h">12h</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs opacity-70">Date format</label>
              <select className="border rounded-md px-2 py-1 text-sm" value={prefs.dateFormat} onChange={e=> setPrefs(prev => ({ ...prev, dateFormat: e.target.value as any }))}>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="MM/DD">MM/DD</option>
                <option value="DD/MM">DD/MM</option>
              </select>
            </div>
          </div>
        )}
        {sidebarOpen && <MiniCalendar value={anchor} onChange={(d)=> { setAnchor(d); setView('day'); }} />}
        {sidebarOpen && (
        <div className="card p-3">
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="font-medium flex items-center gap-2 min-w-0 truncate"><Users size={16} /> People</span>
            <button
              className={`btn ${selectedPerson === null ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSelectedPerson(null)}
              title="Show all tasks"
            >All</button>
          </div>
          {sidebarOpen && (
          <ul className="space-y-1 max-h-[40vh] overflow-auto pr-1">
            <AnimatePresence initial={false}>
              {people.map(p => (
                <PersonRow key={p.id} person={p} active={selectedPerson===p.id}
                  progress={progressByPerson.get(p.id) || { done: 0, total: 0 }}
                  onSelect={() => setSelectedPerson(p.id)}
                  onUpdated={(upd)=> setPeople(prev => prev.map(x => x.id===upd.id ? upd : x))}
                  onDeleted={()=>{
                    setPeople(prev => prev.filter(x => x.id !== p.id));
                    if (selectedPerson === p.id) setSelectedPerson(null);
                  }}
                  onEdit={() => setEditingPerson(p)}
                />
              ))}
            </AnimatePresence>
          </ul>
          )}
          {sidebarOpen && (
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addPerson(new FormData(e.currentTarget)); }}>
            <div className="relative flex-1">
              <input id="name" name="name" placeholder="Add person" className="w-full border rounded-md px-2 py-1.5 pr-8" />
              <UserPlus size={14} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
            </div>
            <button className="btn btn-primary"><Plus size={14} />Add</button>
          </form>
          )}
          {sidebarOpen && selectedPerson != null && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs opacity-70">Details</div>
                <button className="btn btn-ghost text-xs" onClick={()=> setPersonDetailsOpen(v=>!v)}>{personDetailsOpen ? 'Collapse' : 'Expand'}</button>
              </div>
              {personDetailsOpen && (
              <>
              <div className="text-xs opacity-70">Person color</div>
              <ColorDots value={people.find(p=>p.id===selectedPerson)?.color || null} onChange={async (c)=>{
                const id = selectedPerson!;
                await fetch(`/api/people/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: c }) });
                setPeople(prev => prev.map(p => p.id===id ? { ...p, color: c || null } : p));
              }} />
              <div className="mt-4">
                <div className="text-xs opacity-70 mb-1">Connections</div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-ghost" onClick={()=>{ setShowConnect('apple_calendar'); setConnectUrl(''); }}>Apple Calendar</button>
                  <button className="btn btn-ghost" onClick={()=>{ setShowConnect('apple_reminders'); setConnectUrl(''); }}>Apple Reminders</button>
                  <button className="btn btn-ghost" onClick={()=>{ setShowConnect('outlook_calendar'); setConnectUrl(''); }}>Outlook Calendar</button>
                  <button className="btn btn-ghost" onClick={()=>{ setShowConnect('microsoft_todo'); setConnectUrl(''); }}>Microsoft To Do</button>
                </div>
                {showConnect && (
                  <div className="popover mt-2">
                    <div className="text-xs opacity-70 mb-1">Paste public ICS URL for {showConnect.replace('_',' ')}</div>
                    <div className="flex items-center gap-2">
                      <input className="border rounded-md px-2 py-1 flex-1" placeholder="https://...ics" value={connectUrl} onChange={e=>setConnectUrl(e.target.value)} />
                      <button className="btn btn-primary" onClick={async ()=>{
                        if (!connectUrl) return;
                        const res = await fetch('/api/sources', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ person_id: selectedPerson, provider: showConnect, url: connectUrl })});
                        const data = await res.json();
                        if (data?.source) setSources(prev => [data.source, ...prev]);
                        setShowConnect(null); setConnectUrl('');
                      }}>Connect</button>
                      <button className="btn btn-ghost" onClick={()=> setShowConnect(null)}>Cancel</button>
                    </div>
                    <div className="text-[11px] opacity-60 mt-1">Tip: enable public sharing in your calendar/to-do app to obtain an ICS URL.</div>
                    <div className="mt-2 flex gap-2">
                      <button className="btn btn-primary" onClick={()=> window.open(`/api/oauth/ms/start?provider=ms_graph_calendar&personId=${selectedPerson}`, '_blank', 'width=600,height=700') }>Connect Outlook Calendar (OAuth)</button>
                      <button className="btn btn-primary" onClick={()=> window.open(`/api/oauth/ms/start?provider=ms_graph_todo&personId=${selectedPerson}`, '_blank', 'width=600,height=700') }>Connect Microsoft To Do (OAuth)</button>
                    </div>
                  </div>
                )}
                {sources.length>0 && (
                  <div className="mt-2 space-y-1">
                    {sources.map(s => (
                      <div key={s.id} className="flex items-center justify-between text-xs">
                        <span className="truncate">{s.provider.replace('_',' ')}: {s.url}</span>
                        <button className="btn btn-ghost" onClick={async ()=>{
                          await fetch('/api/sources/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ source_id: s.id })});
                          fetchAll();
                        }}>Sync now</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </>
              )}
            </div>
          )}
        </div>
        )}
        {(!isMobile && sidebarOpen) && (
          <div
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-black/10 dark:hover:bg-white/10"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = sidebarOpen ? sidebarWidth : 56;
              const onMove = (ev: MouseEvent) => {
                const dx = ev.clientX - startX;
                const w = Math.max(200, Math.min(520, startW + dx));
                setSidebarOpen(true);
                setSidebarWidth(w);
              };
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          />
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 p-4 md:p-6 space-y-6 pb-28" style={{ paddingBottom: composerHeight + 32 }}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border overflow-hidden bg-white/60 dark:bg-black/30 backdrop-blur-sm">
            {(["day","week","month"] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 capitalize transition-colors ${view===v? 'bg-black text-white dark:bg-white dark:text-black':''}`}>{v}</button>
            ))}
          </div>
          {view !== 'day' ? (
            <div className="inline-flex rounded-lg border overflow-hidden bg-white/60 dark:bg-black/30 backdrop-blur-sm">
              {(['list','grid'] as const).map(l => (
                <button key={l} onClick={() => setLayout(l)} className={`px-3 py-1.5 capitalize transition-colors ${layout===l? 'bg-black text-white dark:bg-white dark:text-black':''}`}>{l}</button>
              ))}
            </div>
          ) : (
            <div className="inline-flex rounded-lg border overflow-hidden bg-white/60 dark:bg-black/30 backdrop-blur-sm">
              {(['list','timeline'] as const).map(l => (
                <button key={l} onClick={() => setLayout(l as any)} className={`px-3 py-1.5 capitalize transition-colors ${layout===l? 'bg-black text-white dark:bg-white dark:text-black':''}`}>{l}</button>
              ))}
            </div>
          )}
          <div className="inline-flex rounded-lg border overflow-hidden bg-white/60 dark:bg-black/30 backdrop-blur-sm">
            <button onClick={() => changeAnchor(-1)} className="px-3 py-1.5" title="Previous"><ChevronLeft size={16} /></button>
            <button onClick={() => setAnchor(new Date())} className="px-3 py-1.5" title="Today"><Calendar size={16} /></button>
            <button onClick={() => changeAnchor(1)} className="px-3 py-1.5" title="Next"><ChevronRight size={16} /></button>
          </div>
          <div className="text-sm opacity-70 flex items-center gap-2"><Clock size={14} /> {anchorLabel}</div>
          <div className="flex items-center gap-2 ml-auto min-w-[180px]">
            <ProgressBar label={selectedPerson ? (people.find(p=>p.id===selectedPerson)?.name || 'Person') : 'All'}
              color={selectedPerson ? (activePersonColor || '#6b7280') : '#6b7280'}
              done={selectedPerson ? (progressByPerson.get(selectedPerson)?.done || 0) : progressAll.done}
              total={selectedPerson ? (progressByPerson.get(selectedPerson)?.total || 0) : progressAll.total}
            />
          </div>
        </div>

        {loading && <div className="text-sm opacity-60">Loading…</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}

        {view === 'day' && layout === 'timeline' ? (
          <DayTimeline date={anchor} items={(grouped.days.find(d => d[0] === formatISODate(anchor))?.[1] || [])}
            onChangeTime={async (id, hhmm) => {
              // optimistic
              setTasks(prev => prev.map(t => t.id===id ? { ...t, due_time: hhmm } : t));
              await fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_time: hhmm }) });
            }}
            isSelected={(id)=> selected.has(id)}
            onSelect={(id, e)=>{
              setSelected(prev => {
                const next = new Set(prev);
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                  if (next.has(id)) next.delete(id); else next.add(id);
                } else { next.clear(); next.add(id); }
                return next;
              });
            }}
            accentFor={accentFor}
          />
        ) : layout === 'grid' && view !== 'day' ? (
          <CalendarGrid
            view={view}
            anchor={anchor}
            grouped={grouped}
            onDropTask={async (ids, dateStr) => {
              // compute base next sort
              const baseNext = (() => {
                const sorts = tasks.filter(x => x.bucket_type==='day' && x.bucket_date===dateStr && typeof x.sort==='number').map(x => x.sort as number);
                return (sorts.length ? Math.max(...sorts) : -1) + 1;
              })();
              setTasks(prev => prev.map(x => {
                const idx = ids.indexOf(x.id);
                if (idx !== -1) return { ...x, bucket_type: 'day', bucket_date: dateStr, sort: baseNext + idx };
                return x;
              }));
              for (let i=0;i<ids.length;i++) {
                const id = ids[i];
                await fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bucket_type: 'day', bucket_date: dateStr, sort: baseNext + i }) });
              }
            }}
            onReorderDay={onReorderDay}
            isSelected={(id)=> selected.has(id)}
            onSelect={(id, e)=>{
              setSelected(prev => {
                const next = new Set(prev);
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                  if (next.has(id)) next.delete(id); else next.add(id);
                } else {
                  next.clear(); next.add(id);
                }
                return next;
              });
            }}
            accentFor={accentFor}
            personById={personById}
            personColorMap={personColorMap}
            prefs={prefs}
          />
        ) : (
          <div className="space-y-8">
            {grouped.days.length === 0 && (
              <div className="opacity-60">No tasks yet. Add one below.</div>
            )}
            <AnimatePresence initial={false}>
              {grouped.days.map(([date, items]) => (
                <motion.section key={date} layout initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}}>
                  <h3 className="font-medium mb-3 flex items-center gap-2"><Calendar size={14} /> {date}</h3>
                  <Reorder.Group as="div" axis="y" values={items} onReorder={(reordered) => onReorderDay(date, reordered)}>
                     <AnimatePresence initial={false}>
                       {items.map(task => (
                    <Reorder.Item as="div" key={task.id} value={task} transition={{type:'spring', stiffness:400, damping:30}}>
                          <TaskRow task={task} selected={selected.has(task.id)} accentColor={accentFor(task)} prefs={prefs} onSelect={(id,e)=>{
                            setSelected(prev => {
                              const next = new Set(prev);
                              if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                if (next.has(id)) next.delete(id); else next.add(id);
                              } else { next.clear(); next.add(id); }
                              return next;
                            });
                          }} onToggle={() => toggleDone(task)} onDelete={() => deleteTask(task)} personName={personById.get(task.person_id || -1)?.name}
                          personColor={personById.get(task.person_id || -1)?.color || personColorMap.get(task.person_id || -1)} />
                        </Reorder.Item>
                      ))}
                    </AnimatePresence>
                  </Reorder.Group>
                </motion.section>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
      <Composer
        people={people}
        view={view}
        anchor={anchor}
        onSubmit={async (payload) => {
          const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          try {
            const data = await res.json();
            if (data?.task) setTasks(prev => prev.some(t=>t.id===data.task.id) ? prev : [data.task, ...prev]);
          } catch {}
        }}
        currentPerson={selectedPerson}
        leftOffset={leftOffset}
        onHeightChange={setComposerHeight}
      />

      {editingPerson && (
        <PersonModal
          person={editingPerson}
          onClose={() => setEditingPerson(null)}
          onSaved={(p)=> setPeople(prev => prev.map(x => x.id===p.id ? p : x))}
        />
      )}
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete, selected=false, onSelect, accentColor, personName, personColor, prefs }: { task: Task; onToggle: () => void; onDelete: () => void; selected?: boolean; onSelect?: (id:number, e: React.MouseEvent)=>void; accentColor?: string; personName?: string; personColor?: string; prefs: UserPrefs; }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(task.due_date || '');
  const [dueTime, setDueTime] = useState(task.due_time || '');
  const [color, setColor] = useState<string | null>(task.color || null);
  const [priority, setPriority] = useState<number>(task.priority ?? 0);
  const saving = useRef(false);
  async function save() {
    saving.current = true;
    await fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, due_date: due || null, due_time: dueTime || null, color, priority }) });
    setEditing(false);
    saving.current = false;
  }
  const accent = accentColor || (color || task.color) || hashToHsl(task.person_id ?? task.id);
  const accentAlpha = withAlpha(accent, 0.3);
  return (
    <motion.div layout initial={{opacity:0, scale:0.98}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.98}} transition={{type:'spring', stiffness:300, damping:24}}
      className={`card p-3 flex items-center gap-3 ${selected ? 'ring-2 ring-black/40 dark:ring-white/40' : ''}`}
      style={{boxShadow: `inset 0 0 0 2px ${accentAlpha}`}}
      onMouseDown={(e)=> onSelect?.(task.id, e)}
    >
      <button onClick={onToggle} className={`size-5 rounded grid place-items-center border transition-colors ${task.status==='done' ? 'bg-emerald-500 text-white border-emerald-600' : 'hover:bg-black/5 dark:hover:bg-white/10'}`} title="Toggle done">
        {task.status==='done' ? <Check size={14}/> : null}
      </button>
      <div className="flex-1 min-w-0">
        {!editing ? (
          <div>
            <div className={`font-medium truncate ${task.status === 'done' ? 'line-through opacity-60' : ''}`}>{task.title}</div>
            <div className="text-xs opacity-70 flex gap-3 items-center flex-wrap">
              {task.due_date && (
                <span className={`chip flex items-center gap-1 ${isOverdue(task) ? 'bg-rose-500/15 text-rose-700 border-rose-600/30' : ''}`}>
                  <Clock size={12}/> {formatDueLabel(task, prefs)}
                  {isOverdue(task) && <span className="ml-1">Overdue</span>}
                </span>
              )}
              <span className={`chip border ${statusColor(task.status)}`}>{task.status.replace('_',' ')}</span>
              {task.recurrence !== 'none' && <span className="chip flex items-center gap-1"><Repeat size={12}/> {task.recurrence}</span>}
              {typeof task.priority === 'number' && task.priority > 0 && (
                <span className={`chip ${priorityClass(task.priority)}`}>{['','Low','Med','High'][task.priority]}</span>
              )}
              {personName && (
                <span className="chip inline-flex items-center gap-1"><span className="size-3 rounded-full" style={{background: personColor || accent}}></span>{personName}</span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex gap-2 items-center flex-wrap">
            <input className="border rounded-md px-2 py-1" value={title} onChange={e => setTitle(e.target.value)} />
            <input className="border rounded-md px-2 py-1" type="date" value={due} onChange={e => setDue(e.target.value)} />
            <input className="border rounded-md px-2 py-1" type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} />
            <ColorDots value={color} onChange={setColor} />
            <select className="border rounded-md px-2 py-1" value={priority} onChange={e=>setPriority(parseInt(e.target.value))}>
              <option value={0}>No priority</option>
              <option value={1}>Low</option>
              <option value={2}>Med</option>
              <option value={3}>High</option>
            </select>
          </div>
        )}
      </div>
      {!editing ? (
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="btn btn-ghost" title="Edit"><Pencil size={14}/></button>
          <button onClick={onDelete} className="btn btn-ghost text-red-600" title="Delete"><Trash2 size={14}/></button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={save} className="btn btn-primary">Save</button>
          <button onClick={() => setEditing(false)} className="btn btn-ghost">Cancel</button>
        </div>
      )}
    </motion.div>
  );
}

function MiniCalendar({ value, onChange }: { value: Date; onChange: (d: Date) => void; }) {
  const [month, setMonth] = useState(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)));
  const today = new Date();
  const start = startOfMonth(month);
  const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
  const startGrid = startOfWeek(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)));
  const cells: Date[] = [];
  for (let i=0;i<42;i++) cells.push(addDays(startGrid, i));
  const isSameDay = (a: Date, b: Date) => a.getUTCFullYear()===b.getUTCFullYear() && a.getUTCMonth()===b.getUTCMonth() && a.getUTCDate()===b.getUTCDate();
  const sameMonth = (d: Date) => d.getUTCMonth() === month.getUTCMonth() && d.getUTCFullYear() === month.getUTCFullYear();
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <button className="btn btn-ghost" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth()-1, 1)))}><ChevronLeft size={14}/></button>
        <div className="text-sm font-medium">{month.toISOString().slice(0,7)}</div>
        <button className="btn btn-ghost" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth()+1, 1)))}><ChevronRight size={14}/></button>
      </div>
      <div className="grid grid-cols-7 text-[11px] opacity-60 mb-1">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d,i) => {
          const isToday = isSameDay(d, new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
          const selected = isSameDay(d, value);
          return (
            <button key={i} onClick={() => onChange(d)} className={`aspect-square rounded-md text-[12px] grid place-items-center border transition-colors ${selected ? 'bg-black text-white dark:bg-white dark:text-black' : sameMonth(d) ? 'hover:bg-black/5 dark:hover:bg-white/10' : 'opacity-40 hover:opacity-60 hover:bg-black/5 dark:hover:bg-white/10'}`}>
              <span className={`${isToday && !selected ? 'underline' : ''}`}>{d.getUTCDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CalendarGrid({ view, anchor, grouped, onDropTask, onReorderDay, isSelected, onSelect, accentFor, personById, personColorMap, prefs }: { view: View; anchor: Date; grouped: { start: Date; end: Date; days: [string, Task[]][] }; onDropTask: (taskIds: number[], dateStr: string) => void | Promise<void>; onReorderDay: (dateKey: string, reordered: Task[]) => void | Promise<void>; isSelected: (id: number)=>boolean; onSelect: (id: number, e: React.MouseEvent) => void; accentFor: (t: Task) => string; personById: Map<number, Person>; personColorMap: Map<number, string>; prefs: UserPrefs; }) {
  const start = view === 'week' ? startOfWeek(anchor) : startOfMonth(anchor);
  const startGrid = view === 'week' ? start : startOfWeek(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)));
  const cells: Date[] = [];
  const total = view === 'week' ? 7 : 42;
  for (let i=0;i<total;i++) cells.push(addDays(startGrid, i));
  const map = new Map(grouped.days);
  const [overKey, setOverKey] = useState<string | null>(null);
  const isSameDay = (a: Date, b: Date) => a.getUTCFullYear()===b.getUTCFullYear() && a.getUTCMonth()===b.getUTCMonth() && a.getUTCDate()===b.getUTCDate();
  const today = new Date();
  // Banners: week/month scoped tasks for current period
  const banners: Task[] = [];
  for (const [k, arr] of map) {
    for (const t of arr) {
      const includeBanner = (
        t.recurrence === 'none' && (
          (view === 'week' && t.bucket_type === 'week') ||
          (view === 'month' && (t.bucket_type === 'week' || t.bucket_type === 'month')) ||
          (t.bucket_type === view)
        )
      );
      if (includeBanner && t.bucket_date) {
        // Only include a single copy
        if (!banners.some(x=>x.id===t.id)) banners.push(t);
      }
    }
  }
  return (
    <div className="card p-2">
      <div className="grid grid-cols-7 gap-2">
        {banners.length > 0 && (
          <div className="col-span-7 flex flex-wrap gap-2 mb-1">
            {banners.map(t => (
              <div key={t.id} className="text-[12px] px-3 py-1 rounded-md border bg-white/70 dark:bg-black/40 backdrop-blur-sm" style={{borderColor: accentFor(t)}}>
                <span className="size-2 inline-block rounded-full mr-1 align-middle" style={{background: accentFor(t)}}></span>
                {t.title}
              </div>
            ))}
          </div>
        )}
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d)=> (
          <div key={d} className="text-[11px] opacity-60 px-1">{d}</div>
        ))}
        {cells.map((d, idx) => {
          const key = formatISODate(d);
          const recurring = (map.get(key) || []).filter(t => t.recurrence !== 'none');
          const dayItems = (map.get(key) || []).filter(t => t.recurrence === 'none' && t.bucket_type === 'day');
          const dim = view==='month' && d.getUTCMonth() !== start.getUTCMonth();
          const isToday = isSameDay(d, new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
          return (
            <div key={idx}
              onDragOver={(e)=>{ e.preventDefault(); setOverKey(key); }}
              onDragEnter={(e)=>{ e.preventDefault(); setOverKey(key); }}
              onDragLeave={(e)=>{ e.preventDefault(); setOverKey(null); }}
              onDrop={(e)=>{
                e.preventDefault();
                let ids: number[] = [];
                const plain = e.dataTransfer.getData('text/plain');
                if (plain) {
                  try {
                    const parsed = JSON.parse(plain);
                    if (Array.isArray(parsed?.ids)) ids = parsed.ids.map((x:any)=>Number(x)).filter(Boolean);
                    else {
                      const n = Number(plain); if (!Number.isNaN(n)) ids = [n];
                    }
                  } catch {
                    const n = Number(plain); if (!Number.isNaN(n)) ids = [n];
                  }
                }
                if (ids.length) onDropTask(ids, key);
                setOverKey(null);
              }}
              className={`min-h-28 rounded-md border p-2 flex flex-col gap-1 transition-colors ${dim? 'opacity-50':''} ${overKey===key? 'ring-2 ring-black/40 dark:ring-white/40':''}`}
            >
              <div className="flex items-center justify-between text-[11px] opacity-70">
                <span>{d.getUTCDate()}</span>
                {isToday && <span className="size-1.5 rounded-full bg-emerald-500"></span>}
              </div>
              <Reorder.Group as="div" axis="y" values={dayItems} onReorder={(reordered) => onReorderDay(key, reordered)}>
                <div className="flex flex-col gap-1">
                  {dayItems.map(t => (
                    <ReorderableChip key={t.id} task={t} value={t}>
                      {(start)=> (
                        <TaskChip task={t} accentColor={accentFor(t)} selected={isSelected(t.id)} onSelect={onSelect} onReorderHandleDown={start}
                          personName={(t.person_id!=null? personById.get(t.person_id||-1)?.name: undefined)}
                          personColor={(t.person_id!=null? (personById.get(t.person_id||-1)?.color || personColorMap.get(t.person_id||-1)) : undefined)}
                          prefs={prefs}
                        />
                      )}
                    </ReorderableChip>
                  ))}
                  {recurring.map(t => (
                    <TaskChip key={`r-${t.id}`} task={t} accentColor={accentFor(t)} selected={isSelected(t.id)} onSelect={onSelect}
                      personName={(t.person_id!=null? personById.get(t.person_id||-1)?.name: undefined)}
                      personColor={(t.person_id!=null? (personById.get(t.person_id||-1)?.color || personColorMap.get(t.person_id||-1)) : undefined)}
                      prefs={prefs}
                    />
                  ))}
                </div>
              </Reorder.Group>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskChip({ task, onToggle, selected=false, onSelect, accentColor, onReorderHandleDown, personName, personColor, prefs }: { task: Task; onToggle?: () => void; selected?: boolean; onSelect?: (id: number, e: React.MouseEvent)=>void; accentColor?: string; onReorderHandleDown?: (e:any)=>void; personName?: string; personColor?: string; prefs: UserPrefs; }) {
  const accent = accentColor || (task.color || null) || hashToHsl(task.person_id ?? task.id);
  return (
    <div className={`text-[12px] px-2 py-1 rounded-md border bg-white/70 dark:bg-black/40 backdrop-blur-sm flex items-center gap-2 ${selected ? 'ring-2 ring-black/40 dark:ring-white/40' : ''}`}
      style={{borderColor: accent}}
      title={task.title}
      onMouseDown={(e)=> onSelect?.(task.id, e)}
    >
      <span className="cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100" onPointerDown={onReorderHandleDown} title="Reorder">
        <GripVertical size={12} />
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="size-2 rounded-full" style={{background: accent}}></span>
      </span>
      {personName && (
        <span className="inline-flex items-center gap-1">
          <span className="size-4 grid place-items-center rounded-full text-[10px] text-white" style={{background: personColor || accent}}>{personName.slice(0,1).toUpperCase()}</span>
        </span>
      )}
      <span className={`truncate ${task.status==='done' ? 'line-through opacity-60':''}`}>{task.title}</span>
      {typeof task.priority === 'number' && task.priority > 0 && <span className={`chip text-[10px] ${priorityClass(task.priority)}`}>{['','L','M','H'][task.priority]}</span>}
      {(task.due_date || task.due_time) && (
        <span className={`ml-auto text-[10px] flex items-center gap-1 ${isOverdue(task) ? 'text-rose-600' : 'opacity-70'}`}>
          <Clock size={10}/>{formatDueLabel(task, prefs)}
          {isOverdue(task) && <span className="ml-0.5">• Overdue</span>}
        </span>
      )}
      <span
        className="ml-1 cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100"
        title="Drag to another day"
        draggable onDragStart={(e)=>{
          let payload: any = { ids: [task.id] };
          // If shift is held, or item is already in a selection with >1 ids, drag them all
          if ((e.shiftKey || e.ctrlKey || e.metaKey) && onSelect) {
            // onSelect will handle selection; drag only this time
          }
          const data = (window as any).currentMultiSelection as number[] | undefined;
          if (data && data.length > 1 && data.includes(task.id)) payload = { ids: data };
          e.dataTransfer.setData('text/plain', JSON.stringify(payload));
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <GripVertical size={12} />
      </span>
      {onToggle && (
        <button onClick={onToggle} className="ml-1 text-[11px] chip">{task.status==='done' ? 'Undone' : 'Done'}</button>
      )}
    </div>
  );
}

function ReorderableChip({ task, children, value }: { task: Task; children: (start:(e:any)=>void)=>React.ReactNode; value: Task }) {
  const controls = useDragControls();
  return (
    <Reorder.Item as="div" value={value} dragListener={false} dragControls={controls}>
      {children((e:any)=> controls.start(e))}
    </Reorder.Item>
  );
}

function ColorDots({ value, onChange }: { value: string | null; onChange: (v: string | null) => void; }) {
  const palette = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];
  return (
    <div className="flex items-center gap-1">
      <button className="chip" onClick={()=>onChange(null)}>None</button>
      {palette.map(c => (
        <button key={c} onClick={()=>onChange(c)} className={`size-5 rounded-full border`} style={{background:c}} title={c}></button>
      ))}
    </div>
  );
}

function ProgressBar({ label, color, done, total, small }: { label?: string; color: string; done: number; total: number; small?: boolean; }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={`flex items-center gap-2 ${small ? 'text-[10px]' : 'text-xs'} min-w-0 w-full`}>
      {label && !small && <span className="truncate opacity-70">{label}</span>}
      <div className={`flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden`}>
        <div className="h-full" style={{width: `${pct}%`, background: color}}></div>
      </div>
      <span className="opacity-60 tabular-nums">{pct}%</span>
    </div>
  );
}

function PersonRow({ person, active, onSelect, progress, onUpdated, onDeleted, onEdit }: { person: Person; active: boolean; onSelect: () => void; progress: {done:number,total:number}; onUpdated: (p: Person)=>void; onDeleted: ()=>void; onEdit: ()=>void; }) {
  const color = person.color || hashToHsl(person.id);
  async function remove() {
    if (!confirm('Delete person? Their tasks will be unassigned.')) return;
    await fetch(`/api/people/${person.id}`, { method:'DELETE' });
    onDeleted();
  }
  return (
    <motion.li layout initial={{opacity:0, y:4}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-4}}>
      <div className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md ${active ? 'bg-black text-white dark:bg-white dark:text-black' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}>
        <button onClick={onSelect} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="inline-grid place-items-center size-5 rounded-full" style={{background: color}}>
            <span className="text-[10px] font-semibold text-white mix-blend-difference">{person.name.slice(0,1).toUpperCase()}</span>
          </span>
          <span className="truncate">{person.name}</span>
        </button>
        <button className="btn btn-ghost" title="Edit" onClick={onEdit}><Pencil size={14} /></button>
        <button className="btn btn-ghost text-red-600" title="Delete" onClick={remove}><Trash2 size={14} /></button>
      </div>
      <div className="mt-1">
        <ProgressBar small color={color} done={progress.done} total={progress.total} />
      </div>
    </motion.li>
  );
}

function DayTimeline({ date, items, onChangeTime, isSelected, onSelect, accentFor }: { date: Date; items: Task[]; onChangeTime: (id: number, hhmm: string) => void | Promise<void>; isSelected: (id:number)=>boolean; onSelect: (id:number, e: React.MouseEvent)=>void; accentFor: (t: Task)=>string; }) {
  const hourHeight = 40; // px per hour
  const totalH = 24 * hourHeight;
  const dateKey = formatISODate(date);
  const toY = (t?: string | null) => t ? (hhmmToMinutes(t) / 60) * hourHeight : 9 * hourHeight; // default 9:00
  const clampY = (y:number) => Math.max(0, Math.min(totalH - 1, y));
  return (
    <div className="card p-0 overflow-hidden">
      <div className="relative" style={{ height: totalH }}>
        {/* Hour lines */}
        {Array.from({length:24}).map((_,h) => (
          <div key={h} className="absolute left-0 right-0 border-t border-black/10 dark:border-white/10 text-[10px] opacity-50" style={{ top: h*hourHeight }}>
            <span className="absolute left-1 -translate-y-1/2">{String(h).padStart(2,'0')}:00</span>
          </div>
        ))}
        {/* Tasks */}
        {items.map((t, i) => {
          if (t.bucket_type !== 'day' || t.bucket_date !== dateKey) return null;
          const accent = accentFor(t);
          const initialY = toY(t.due_time);
          const left = 8 + (i % 3) * 6; // tiny fan to reduce overlap
          return (
            <motion.div key={t.id} drag="y" dragConstraints={{ top: 0, bottom: totalH-1 }}
              initial={false}
              className={`absolute right-2 rounded-md border px-2 py-1 text-[12px] bg-white/70 dark:bg-black/40 backdrop-blur-sm ${isSelected(t.id)?'ring-2 ring-black/40 dark:ring-white/40':''}`}
              style={{ top: initialY, left, borderColor: accent }}
              onMouseDown={(e)=> onSelect(t.id, e)}
              onDragEnd={(_, info)=>{
                const y = clampY(info.point.y);
                const mins = Math.round((y / hourHeight) * 60 / 5) * 5; // 5-min steps
                onChangeTime(t.id, minutesToHHMM(mins));
              }}
            >
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{background: accent}}></span>
                <span className={`truncate ${t.status==='done' ? 'line-through opacity-60':''}`}>{t.title}</span>
                <span className="ml-auto text-[10px] opacity-60">{t.due_time || '—'}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function PersonModal({ person, onClose, onSaved }: { person: Person; onClose: ()=>void; onSaved: (p: Person)=>void; }) {
  const [name, setName] = useState(person.name);
  const [color, setColor] = useState<string | null>(person.color || null);
  const [sources, setSources] = useState<ExternalSource[]>([]);
  const [showConnect, setShowConnect] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState('');
  const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
  const [editingSourceUrl, setEditingSourceUrl] = useState<string>('');
  useEffect(() => {
    fetch(`/api/sources?personId=${person.id}`).then(r=>r.json()).then(d=> setSources(d.sources||[])).catch(()=>setSources([]));
  }, [person.id]);

  async function save() {
    const res = await fetch(`/api/people/${person.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, color })});
    const data = await res.json();
    if (data?.person) onSaved(data.person);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose}></div>
      <div className="relative w-[95vw] max-w-lg card p-4 bg-white/95 dark:bg-black/60">
        <h3 className="text-lg font-semibold mb-3">Edit person</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm w-20">Name</label>
            <input className="border rounded-md px-2 py-1 flex-1" value={name} onChange={e=>setName(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm w-20">Color</label>
            <ColorDots value={color} onChange={setColor} />
          </div>
          <div>
            <div className="text-xs opacity-70 mb-1">Connections</div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-ghost" onClick={()=>{ setShowConnect('apple_calendar'); setConnectUrl(''); }}>Apple Calendar (ICS)</button>
              <button className="btn btn-ghost" onClick={()=>{ setShowConnect('apple_reminders'); setConnectUrl(''); }}>Apple Reminders (ICS)</button>
              <button className="btn btn-ghost" onClick={()=>{ setShowConnect('outlook_calendar'); setConnectUrl(''); }}>Outlook Calendar (ICS)</button>
              <button className="btn btn-ghost" onClick={()=>{ setShowConnect('microsoft_todo'); setConnectUrl(''); }}>Microsoft To Do (ICS)</button>
              <button className="btn btn-primary" onClick={()=> window.open(`/api/oauth/ms/start?provider=ms_graph_calendar&personId=${person.id}`, '_blank', 'width=600,height=700') }>Connect Outlook Calendar (OAuth)</button>
              <button className="btn btn-primary" onClick={()=> window.open(`/api/oauth/ms/start?provider=ms_graph_todo&personId=${person.id}`, '_blank', 'width=600,height=700') }>Connect Microsoft To Do (OAuth)</button>
            </div>
            {showConnect && (
              <div className="popover mt-2">
                <div className="text-xs opacity-70 mb-1">Paste public ICS URL for {showConnect.replace('_',' ')}</div>
                <div className="flex items-center gap-2">
                  <input className="border rounded-md px-2 py-1 flex-1" placeholder="https://...ics" value={connectUrl} onChange={e=>setConnectUrl(e.target.value)} />
                  <button className="btn btn-primary" onClick={async ()=>{
                    if (!connectUrl) return;
                    const res = await fetch('/api/sources', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ person_id: person.id, provider: showConnect, url: connectUrl })});
                    const data = await res.json();
                    if (data?.source) setSources(prev => [data.source, ...prev]);
                    setShowConnect(null); setConnectUrl('');
                  }}>Connect</button>
                  <button className="btn btn-ghost" onClick={()=> setShowConnect(null)}>Cancel</button>
                </div>
                <div className="text-[11px] opacity-60 mt-1">Tip: enable public sharing in your calendar/to‑do app to obtain an ICS URL.</div>
              </div>
            )}
            {sources.length>0 && (
              <div className="mt-2 space-y-1 max-h-40 overflow-auto">
                {sources.map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="truncate flex-1">{s.provider.replace('_',' ')}: {editingSourceId===s.id ? '' : (s.url || '(OAuth)')}</span>
                    {editingSourceId===s.id ? (
                      <>
                        <input className="border rounded-md px-2 py-0.5 text-xs flex-1" value={editingSourceUrl} onChange={e=>setEditingSourceUrl(e.target.value)} placeholder="https://...ics" />
                        <button className="btn btn-primary" onClick={async ()=>{
                          const res = await fetch(`/api/sources/${s.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: editingSourceUrl || null })});
                          const data = await res.json();
                          if (data?.source) setSources(prev => prev.map(x => x.id===s.id ? data.source : x));
                          setEditingSourceId(null); setEditingSourceUrl('');
                        }}>Save</button>
                        <button className="btn btn-ghost" onClick={()=>{ setEditingSourceId(null); setEditingSourceUrl(''); }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-ghost" onClick={async ()=>{
                          await fetch('/api/sources/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ source_id: s.id })});
                        }}>Sync now</button>
                        <button className="btn btn-ghost" onClick={()=>{ setEditingSourceId(s.id); setEditingSourceUrl(s.url || ''); }}>Edit</button>
                        <button className="btn btn-ghost text-red-600" onClick={async ()=>{
                          await fetch(`/api/sources/${s.id}`, { method:'DELETE' });
                          setSources(prev => prev.filter(x => x.id !== s.id));
                        }}>Delete</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
function Composer({ people, view, anchor, onSubmit, currentPerson, leftOffset, onHeightChange }: { people: Person[]; view: View; anchor: Date; onSubmit: (payload: any) => Promise<void>; currentPerson: number | null; leftOffset: number; onHeightChange?: (h: number)=>void; }) {
  const [title, setTitle] = useState("");
  const [personId, setPersonId] = useState<number | null>(currentPerson);
  const [due, setDue] = useState<string>("");
  const [dueTime, setDueTime] = useState<string>("");
  const [recurrence, setRecurrence] = useState<Task['recurrence']>('none');
  const [interval, setInterval] = useState<number>(1);
  const [byweekday, setByweekday] = useState<number[]>([]);
  const [scope, setScope] = useState<View>(view);
  const [color, setColor] = useState<string | null>(null);
  const [priority, setPriority] = useState<number>(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  useEffect(() => { 
    setPersonId(currentPerson); 
    setScope(view);
    // default color from selected person
    if (currentPerson != null) {
      const p = people.find((x)=>x.id===currentPerson);
      if (p && p.color) setColor(p.color);
    }
  }, [currentPerson, view, people]);

  const bucket_type = scope;
  const bucket_date = scope === 'day' ? formatISODate(anchor) : scope === 'week' ? formatISODate(startOfWeek(anchor)) : formatISODate(startOfMonth(anchor));

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    // Natural language parsing
    const parsed = parseQuickAdd(t, anchor);
    let finalTitle = parsed.title;
    // Assignee
    let finalPerson = personId;
    if (parsed.assignee) {
      const cand = people.find(p => p.name.toLowerCase().startsWith(parsed.assignee!.toLowerCase()));
      if (cand) finalPerson = cand.id;
    }
    const payload: any = { title: finalTitle, person_id: finalPerson, bucket_type, bucket_date, recurrence, interval };
    if (due) payload.due_date = due; else if (parsed.due_date) { payload.due_date = parsed.due_date; }
    if (dueTime) payload.due_time = dueTime; else if (parsed.due_time) payload.due_time = parsed.due_time;
    if (parsed.recurrence) payload.recurrence = parsed.recurrence;
    if (parsed.interval) payload.interval = parsed.interval;
    if (payload.recurrence === 'weekly') {
      const w = byweekday.length ? byweekday : parsed.byweekday || [];
      if (w.length) payload.byweekday = w;
    }
    // If NL parsed a date, prefer day scope anchored to that date
    if (parsed.due_date) {
      payload.bucket_type = 'day';
      payload.bucket_date = parsed.due_date;
    }
    // Scope override via #day/#week/#month
    if (parsed.scope) {
      payload.bucket_type = parsed.scope;
      payload.bucket_date = parsed.scope === 'day' ? (payload.due_date || bucket_date)
        : parsed.scope === 'week' ? formatISODate(startOfWeek(anchor))
        : formatISODate(startOfMonth(anchor));
    }
    if (color || parsed.color) payload.color = color || parsed.color;
    if (priority || parsed.priority) payload.priority = priority || parsed.priority;
    await onSubmit(payload);
    setTitle(""); setDue(""); setDueTime(""); setByweekday([]); setColor(null); setPriority(0);
    setAssignOpen(false); setDateOpen(false); setMoreOpen(false);
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!onHeightChange) return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        onHeightChange(Math.ceil(en.contentRect.height));
      }
    });
    ro.observe(el);
    // initial
    onHeightChange(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [onHeightChange]);

  return (
    <div className="fixed bottom-0 right-0 p-4 z-50" style={{ left: leftOffset }}>
      <motion.div ref={containerRef} initial={{y:20, opacity:0}} animate={{y:0, opacity:1}} className="mx-auto max-w-5xl card p-3 shadow-lg">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-56">
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder={`Quick add a ${view} task`} className="w-full border rounded-md px-3 py-2 pr-7" onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); }}} />
            <Plus size={16} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50" />
          </div>
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost relative" onClick={()=>setAssignOpen(v=>!v)} title="Assign">
              <User size={16} />
              {personId !== null && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-black dark:bg-white"></span>}
            </button>
            <button className="btn btn-ghost relative" onClick={()=>setDateOpen(v=>!v)} title="Due date">
              <Calendar size={16} />
              {(due || dueTime) && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-black dark:bg-white"></span>}
            </button>
            <button className="btn btn-ghost relative" onClick={()=>setMoreOpen(v=>!v)} title="More">
              <Settings2 size={16} />
              {((recurrence!=='none') || interval>1 || priority>0 || !!color) && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-black dark:bg-white"></span>}
            </button>
            <button className="btn btn-primary" onClick={submit}>Add</button>
          </div>
        </div>
        {/* Inline chips showing selected modifiers */}
        <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
          {personId !== null && (()=>{
            const p = people.find(x=>x.id===personId); if (!p) return null;
            const color = hashToHsl(p.id);
            return <span className="chip flex items-center gap-1"><span className="size-2 rounded-full" style={{background: color}}></span>{p.name}<ChevronDown size={12}/></span>;
          })()}
          {(due || dueTime) && <span className="chip flex items-center gap-1"><Clock size={12}/>{due}{dueTime?` ${dueTime}`:''}<ChevronDown size={12}/></span>}
          {recurrence!=='none' && <span className="chip flex items-center gap-1"><Repeat size={12}/>{recurrence} {interval>1?`×${interval}`:''}<ChevronDown size={12}/></span>}
          {priority>0 && <span className="chip">{['','Low','Med','High'][priority]}<ChevronDown size={12}/></span>}
          {color && <span className="chip"><span className="size-2 inline-block rounded-full mr-1" style={{background: color}}></span>Color<ChevronDown size={12}/></span>}
          <span className="chip flex items-center gap-1"><Hash size={12}/>{scope} • {bucket_date}</span>
        </div>

        <AnimatePresence>
          {assignOpen && (
            <motion.div initial={{opacity:0, y:4}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-4}} className="popover">
              <div className="flex gap-2 flex-wrap">
                <button className={`btn ${personId===null?'btn-primary':'btn-ghost'}`} onClick={()=>setPersonId(null)}>Unassigned</button>
                {people.map(p=>{
                  const color = hashToHsl(p.id);
                  const active = personId===p.id;
                  return (
                    <button key={p.id} className={`btn ${active?'btn-primary':'btn-ghost'}`} onClick={()=>setPersonId(p.id)}>
                      <span className="size-2 rounded-full" style={{background: color}}></span>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {dateOpen && (
            <motion.div initial={{opacity:0, y:4}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-4}} className="popover">
              <div className="flex items-center gap-2 flex-wrap">
                <button className="chip" onClick={()=> setDue(formatISODate(new Date()))}>Today</button>
                <button className="chip" onClick={()=> setDue(formatISODate(addDays(new Date(),1)))}>Tomorrow</button>
                <button className="chip" onClick={()=> setDue(formatISODate(nextWeekday(new Date(),1)))}>Next Mon</button>
              </div>
              <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <input type="date" value={due} onChange={e=>setDue(e.target.value)} className="border rounded-md px-2 py-1" />
                <input type="range" min={0} max={1435} step={5} value={dueTime ? hhmmToMinutes(dueTime) : 540}
                  onChange={(e)=> setDueTime(minutesToHHMM(parseInt(e.target.value)))}
                  className="w-full accent-black dark:accent-white" />
                <input type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)} className="border rounded-md px-2 py-1 w-[110px]" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {moreOpen && (
            <motion.div initial={{opacity:0, y:4}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-4}} className="popover space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-70">Recurrence</span>
                <select value={recurrence} onChange={e=>setRecurrence(e.target.value as any)} className="border rounded-md px-2 py-1">
                  <option value="none">none</option>
                  <option value="daily">daily</option>
                  <option value="weekly">weekly</option>
                  <option value="monthly">monthly</option>
                </select>
                <span className="text-xs opacity-70">Interval</span>
                <input type="number" min={1} value={interval} onChange={e=>setInterval(parseInt(e.target.value||'1')||1)} className="border rounded-md px-2 py-1 w-20" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-70">Priority</span>
                {[0,1,2,3].map(p => (
                  <button key={p} className={`chip ${priority===p?'bg-black/10 dark:bg-white/20':''}`} onClick={()=>setPriority(p)}>
                    {['None','Low','Med','High'][p]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-70">Color</span>
                <ColorDots value={color} onChange={setColor} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-70">Scope</span>
                <select value={scope} onChange={e=>setScope(e.target.value as View)} className="border rounded-md px-2 py-1">
                  <option value="day">day</option>
                  <option value="week">week</option>
                  <option value="month">month</option>
                </select>
              </div>
              {recurrence==='weekly' && (
                <div className="flex items-center gap-1 flex-wrap">
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=>{
                    const active = byweekday.includes(i);
                    return (
                      <button key={i} className={`px-2 py-1 rounded-md border text-xs ${active? 'bg-black text-white dark:bg-white dark:text-black':''}`} onClick={()=> setByweekday(prev => active ? prev.filter(x=>x!==i) : [...prev, i])}>{d}</button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
}
