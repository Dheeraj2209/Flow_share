"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, Reorder, useDragControls } from "framer-motion";
import { Calendar, Check, ChevronLeft, ChevronRight, ListPlus, Plus, Share2, UserPlus, Users, Repeat, Clock, Trash2, Pencil, User, ChevronDown, Hash, Settings2, GripVertical, BookOpen, Apple } from "lucide-react";
// Components
import MiniCalendar from '@/components/MiniCalendar';
// Types & utils
import { Person, Task, ExternalSource, View, UserPrefs } from '@/types';
import { startOfWeek, startOfMonth, formatISODate, formatLocalISODate, addDays, minutesToHHMM, hhmmToMinutes, nextWeekday, parseDueDate as parseDueDateUtil, isOverdueDate, formatTimeLocal, formatDateLocal, isSameDay } from '@/lib/date';
import { parseQuickAdd } from '@/lib/parse';
import { expandTaskInstances } from '@/lib/schedule';
import { hashToHsl, withAlpha, statusColor, priorityClass } from '@/lib/colors';
import { getAll, createPerson as apiCreatePerson, updateTask as apiUpdateTask, toggleTaskDoneOnDate, deleteTask as apiDeleteTask, updatePerson as apiUpdatePerson, deletePerson as apiDeletePerson, getSources as apiGetSources, createSource as apiCreateSource, updateSource as apiUpdateSource, syncSource as apiSyncSource, deleteSource as apiDeleteSource, createTask as apiCreateTask } from '@/services/api';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useLocalStorage } from '@/hooks/useLocalStorage';

// helpers moved to '@/lib/*'

function parseDueDate(task: Task): Date | null {
  return parseDueDateUtil(task.due_date, task.due_time);
}

function isOverdue(task: Task): boolean {
  if (task.status === 'done') return false;
  return isOverdueDate(parseDueDate(task));
}

// formatTimeLocal/formatDateLocal moved to '@/lib/date'

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

// recurrence helpers moved to '@/lib/schedule'

// realtime updates handled inline with incremental SSE handlers

export default function Home() {
  if (process.env.NEXT_PUBLIC_API_ONLY === '1') {
    const pagesUrl = 'https://dheeraj2209.github.io/Flow_share/';
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="max-w-xl text-center space-y-3">
          <h1 className="text-2xl font-semibold">Flowshare API Server</h1>
          <p className="opacity-80">This deployment serves API routes only. Visit the UI on GitHub Pages.</p>
          <p>
            <a className="btn btn-primary" href={pagesUrl}>Open UI</a>
          </p>
          {apiBase && (
            <p className="text-xs opacity-60">API Base: {apiBase}</p>
          )}
        </div>
      </div>
    );
  }
  const [people, setPeople] = useState<Person[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [doneByDate, setDoneByDate] = useState<Map<string, Set<number>>>(new Map());
  const [selectedPerson, setSelectedPerson] = useState<number | null>(null);
  const [view, setView] = useState<View>("week");
  const [layout, setLayout] = useState<'list'|'grid'|'timeline'>('list');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useLocalStorage<boolean>('sidebarOpen', true);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage<number>('sidebarWidth', 288);
  const isMobile = useIsMobile(768);
  const [sources, setSources] = useState<ExternalSource[]>([]);
  const [showConnect, setShowConnect] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState<string>('');
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useLocalStorage<UserPrefs>('flow_prefs', { relativeDates: true, timeFormat: '24h', dateFormat: 'YYYY-MM-DD' });
  const [calendarOpen, setCalendarOpen] = useLocalStorage<boolean>('calendarOpen', true);
  // Mini calendar selection: null = shade today; clicking a date sets selection
  const [miniSelected, setMiniSelected] = useState<Date | null>(null);
  const [peopleOpen, setPeopleOpen] = useLocalStorage<boolean>('peopleOpen', true);
  type SortMode = 'manual' | 'priority' | 'due';
  const [sortMode, setSortMode] = useLocalStorage<SortMode>('sortMode', 'manual');
  // Manual order for any tasks on a specific date (YYYY-MM-DD -> ids)
  const [orderByDate, setOrderByDate] = useLocalStorage<Map<string, number[]>>(
    'orderByDate',
    new Map(),
    {
      serialize: (m) => JSON.stringify(Object.fromEntries(m)),
      deserialize: (s) => {
        try {
          const obj = JSON.parse(s) as Record<string, number[]>;
          return new Map(Object.entries(obj));
        } catch {
          return new Map();
        }
      }
    }
  );

  const [personDetailsOpen, setPersonDetailsOpen] = useLocalStorage<boolean>('personDetailsOpen', true);
  // isMobile tracked via hook

  const anchorLabel = useMemo(() => {
    const d = anchor;
    if (view === "day") return formatLocalISODate(d);
    if (view === "week") {
      const s = startOfWeek(d);
      const e = addDays(s, 6);
      // Display as local dates to avoid UTC offset confusion
      return `${formatLocalISODate(s)} → ${formatLocalISODate(e)}`;
    }
    const s = startOfMonth(d);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    return `${formatLocalISODate(s)} (${e.getDate()} days)`;
  }, [anchor, view]);

  const refresh = useRef(0);
  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const { people: p, tasks: t, doneByDate: dmap } = await getAll();
      setPeople(p);
      setTasks(t);
      setDoneByDate(dmap);
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
      apiGetSources(selectedPerson).then(d=> setSources(d.sources||[])).catch(()=>setSources([]));
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
            await apiUpdateTask(id, { due_time: minutesToHHMM(clamped) });
          }
        })();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, tasks]);

  // Update the anchor date at local midnight so "Today" rolls over automatically
  useEffect(() => {
    let timer: any;
    const schedule = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const delay = next.getTime() - now.getTime() + 1000; // 1s after midnight
      timer = setTimeout(() => {
        setAnchor(new Date());
        schedule();
      }, Math.max(1000, delay));
    };
    schedule();
    return () => { if (timer) clearTimeout(timer); };
  }, []);
  useEffect(() => {
    // SSE with incremental updates for low-latency sync
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const src = new EventSource(`${apiBase}/api/stream`);
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
        const payload = JSON.parse(e.data);
        if (payload && payload.task) {
          const task = payload.task as Task;
          setTasks(prev => prev.map(t => t.id === task.id ? task : t));
        }
        if (payload && payload.task_id && payload.done_on) {
          const tid = Number(payload.task_id);
          const dateKey = String(payload.done_on);
          const done = payload.done !== false;
          setDoneByDate(prev => {
            const m = new Map(prev);
            const set = new Set(m.get(dateKey) || new Set<number>());
            if (done) set.add(tid); else set.delete(tid);
            m.set(dateKey, set);
            return m;
          });
        }
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
    const start = view === 'day'
      ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
      : view === 'week' ? startOfWeek(anchor)
      : startOfMonth(anchor);
    const end = view === 'day' ? addDays(start, 1)
      : view === 'week' ? addDays(start, 7)
      : new Date(start.getFullYear(), start.getMonth() + 1, 1);

    const relevant = tasks.filter(t => selectedPerson ? (t.person_id === selectedPerson) : true);
    const push = (dateKey: string, task: Task) => {
      if (!task) return;
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(task);
    };
    for (const t of relevant) {
      if (t.recurrence === 'none') {
        // Always include day-level tasks in wider views
        if (t.bucket_type === 'day' && t.bucket_date) {
          const dt = new Date(t.bucket_date + 'T00:00:00');
          if (dt >= start && dt < end) push(t.bucket_date, t);
          continue;
        }
        // Include week-level tasks when viewing month (anchor on week start)
        if (view === 'month' && t.bucket_type === 'week' && t.bucket_date) {
          const dt = new Date(t.bucket_date + 'T00:00:00');
          if (dt >= start && dt < end) push(t.bucket_date, t);
          continue;
        }
        // Include tasks anchored to the current view period
        if (t.bucket_type === view && t.bucket_date) {
          const dt = new Date(t.bucket_date + 'T00:00:00');
          if (dt >= start && dt < end) push(t.bucket_date, t);
        }
        continue;
      }
      // Recurring: expand to dates
      for (const date of expandTaskInstances(t, view, anchor)) push(date, t);
    }
    // Sort tasks inside each day
    for (const [k, arr] of map) {
      arr.sort((a, b) => {
        // Sorting strategy
        if (sortMode === 'priority') {
          const pa = a.priority || 0, pb = b.priority || 0;
          if (pb !== pa) return pb - pa; // high first
        } else if (sortMode === 'due') {
          const da = parseDueDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
          const db = parseDueDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
          if (da !== db) return da - db;
        } else {
          // manual: use persisted order (any task), fallback to 'sort' for day tasks
          const orderList = orderByDate.get(k) || [];
          const ia = orderList.indexOf(a.id);
          const ib = orderList.indexOf(b.id);
          if (ia !== -1 || ib !== -1) {
            const xa = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
            const xb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
            if (xa !== xb) return xa - xb;
          }
          const sa = a.sort ?? 0, sb = b.sort ?? 0;
          if (sa !== sb) return sa - sb;
        }
        const aStatus = (a.recurrence !== 'none' && (doneByDate.get(k)?.has(a.id))) ? 'done' : a.status;
        const bStatus = (b.recurrence !== 'none' && (doneByDate.get(k)?.has(b.id))) ? 'done' : b.status;
        if (aStatus !== bStatus) return aStatus > bStatus ? 1 : -1;
        return a.title.localeCompare(b.title);
      });
    }
    return {
      start,
      end,
      days: Array.from(map.entries()).sort((a,b) => a[0].localeCompare(b[0]))
    };
  }, [tasks, selectedPerson, view, anchor, refresh.current, doneByDate, sortMode, orderByDate]);

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
    for (const [, items] of grouped.days) for (const t of items) { if (t && typeof t.id === 'number') ids.add(t.id); }
    let done = 0, total = 0;
    for (const t of tasks) if (t && typeof t.id === 'number' && ids.has(t.id)) { total++; if (t.status === 'done') done++; }
    return { done, total };
  }, [grouped, tasks]);

  const progressByPerson = useMemo(() => {
    const idsByPerson = new Map<number, Set<number>>();
    for (const [, items] of grouped.days) for (const t of items) if (t && t.person_id != null) {
      if (!idsByPerson.has(t.person_id)) idsByPerson.set(t.person_id, new Set());
      idsByPerson.get(t.person_id)!.add(t.id as number);
    }
    const map = new Map<number, {done:number,total:number}>();
    for (const [pid, ids] of idsByPerson) {
      let done = 0, total = 0;
      for (const t of tasks) if (t && typeof t.id === 'number' && ids.has(t.id)) { total++; if (t.status === 'done') done++; }
      map.set(pid, { done, total });
    }
    return map;
  }, [grouped, tasks]);

  async function addPerson(formData: FormData) {
    const name = String(formData.get('name') || '').trim();
    if (!name) return;
    try {
      const data = await apiCreatePerson(name);
      if (data?.person) setPeople(prev => prev.some(p=>p.id===data.person.id) ? prev : [...prev, data.person]);
    } catch {}
    (document.getElementById('name') as HTMLInputElement).value = '';
  }

  // task creation moved to the bottom Composer

  async function toggleDone(task: Task, dateKey?: string) {
    if (task.recurrence !== 'none' && dateKey) {
      // toggle per-instance for the given date
      const isDone = doneByDate.get(dateKey)?.has(task.id) || false;
      // optimistic update of doneByDate
      setDoneByDate(prev => {
        const m = new Map(prev);
        if (!m.has(dateKey)) m.set(dateKey, new Set());
        const set = new Set(m.get(dateKey));
        if (isDone) set.delete(task.id); else set.add(task.id);
        m.set(dateKey, set);
        return m;
      });
      try {
        await toggleTaskDoneOnDate(task.id, dateKey, !isDone);
      } catch {
        fetchAll();
      }
      return;
    }
    // non-recurring: toggle whole task status
    const status = task.status === 'done' ? 'todo' : 'done';
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
    apiUpdateTask(task.id, { status }).catch(()=>{
      fetchAll();
    });
  }

  async function deleteTask(task: Task) {
    if (!confirm('Delete task?')) return;
    // optimistic
    setTasks(prev => prev.filter(t => t.id !== task.id));
    apiDeleteTask(task.id).catch(()=>{
      fetchAll();
    });
  }

  async function onReorderDay(dateKey: string, reorderedIds: number[]) {
    // Store full order for this date (affects all tasks, including recurring)
    setOrderByDate(prev => {
      const next = new Map(prev);
      next.set(dateKey, Array.from(reorderedIds));
      return next;
    });
    // Persist sort for day-level tasks only (backend schema)
    const updates: { id: number; sort: number }[] = [];
    let idx = 0;
    for (const id of reorderedIds) {
      const t = tasks.find(x => x.id === id);
      if (!t) continue;
      if (t.bucket_type === 'day' && t.bucket_date === dateKey) {
        const current = t.sort ?? 0;
        if (current !== idx) updates.push({ id, sort: idx });
        idx++;
      }
    }
    if (updates.length) {
      setTasks(prev => {
        const map = new Map(prev.map(p => [p.id, p] as const));
        for (const u of updates) {
          const cur = map.get(u.id);
          if (cur) map.set(u.id, { ...cur, sort: u.sort });
        }
        return Array.from(map.values());
      });
      for (const u of updates) {
        await apiUpdateTask(u.id, { sort: u.sort });
      }
    }
  }
  async function onReorderPeriod(periodKey: string, reorderedIds: number[]) {
    const periodTasks = tasks.filter(t => (t.bucket_type === view) && t.bucket_date === periodKey);
    const setIds = new Set(reorderedIds);
    const filtered = reorderedIds.filter(id => periodTasks.some(t => t.id === id));
    const updates: { id: number; sort: number }[] = [];
    let idx = 0;
    for (const id of filtered) {
      const t = periodTasks.find(x => x.id === id);
      if (!t) continue;
      const current = t.sort ?? 0;
      if (current !== idx) updates.push({ id, sort: idx });
      idx++;
    }
    setTasks(prev => prev.map(t => (setIds.has(t.id) && t.bucket_type===view && t.bucket_date===periodKey) ? { ...t, sort: (updates.find(u=>u.id===t.id)?.sort ?? (t.sort||0)) } : t));
    for (const u of updates) {
      await apiUpdateTask(u.id, { sort: u.sort });
    }
  }

function changeAnchor(delta: number) {
  if (view === 'day') setAnchor(addDays(anchor, delta));
  else if (view === 'week') setAnchor(addDays(anchor, delta * 7));
  else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, anchor.getDate()));
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
        {sidebarOpen && (
          <div className="card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium flex items-center gap-2 min-w-0 truncate"><Calendar size={16} /> Calendar</span>
              <button className="icon-btn rotate-0 transition-transform" onClick={()=> setCalendarOpen(v=>!v)} title={calendarOpen? 'Collapse' : 'Expand'}>
                <ChevronDown size={16} className={`${calendarOpen ? 'rotate-0' : '-rotate-90'} transition-transform`} />
              </button>
            </div>
            <AnimatePresence initial={false}>
              {calendarOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                  <div className="mt-2">
                    <MiniCalendar value={anchor} onChange={(d)=> { setMiniSelected(d); setAnchor(d); setView('day'); }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {sidebarOpen && (
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2 gap-2">
              <span className="font-medium flex items-center gap-2 min-w-0 truncate"><Users size={16} /> People</span>
              <div className="flex items-center gap-1">
                <button className={`btn ${selectedPerson === null ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSelectedPerson(null)} title="Show all tasks">All</button>
                <button className="icon-btn" onClick={()=> setPeopleOpen(v=>!v)} title={peopleOpen? 'Collapse' : 'Expand'}>
                  <ChevronDown size={16} className={`${peopleOpen ? 'rotate-0' : '-rotate-90'} transition-transform`} />
                </button>
              </div>
            </div>
            <AnimatePresence initial={false}>
              {peopleOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
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
                  <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addPerson(new FormData(e.currentTarget)); }}>
                    <div className="relative flex-1">
                      <input id="name" name="name" placeholder="Add person" className="w-full border rounded-md px-2 py-1.5 pr-8" />
                      <UserPlus size={14} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
                    </div>
                    <button className="btn btn-primary"><Plus size={14} />Add</button>
                  </form>
                  {selectedPerson != null && (
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
                        await apiUpdatePerson(id, { color: c || null });
                        setPeople(prev => prev.map(p => p.id===id ? { ...p, color: c || null } : p));
                      }} />
                      <div className="mt-4">
                        <div className="text-xs opacity-70 mb-1">Connections</div>
                        <div className="flex flex-wrap gap-2">
                          <button className="btn btn-ghost inline-flex items-center gap-1" onClick={()=>{ setShowConnect('apple_calendar'); setConnectUrl(''); }}>
                            <Apple size={14} /> Apple Calendar
                          </button>
                          <button className="btn btn-ghost inline-flex items-center gap-1" onClick={()=>{ setShowConnect('apple_reminders'); setConnectUrl(''); }}>
                            <Apple size={14} /> Apple Reminders
                          </button>
                          <button className="btn btn-ghost inline-flex items-center gap-1" onClick={()=>{ setShowConnect('outlook_calendar'); setConnectUrl(''); }}>
                            <Calendar size={14} className="text-[#0078D4]" /> Outlook Calendar
                          </button>
                          <button className="btn btn-ghost inline-flex items-center gap-1" onClick={()=>{ setShowConnect('microsoft_todo'); setConnectUrl(''); }}>
                            <ListPlus size={14} className="text-[#2564EB]" /> Microsoft To Do
                          </button>
                        </div>
                        {showConnect && (
                          <div className="popover mt-2">
                            <div className="text-xs opacity-70 mb-1">Paste public ICS URL for {showConnect.replace('_',' ')}</div>
                            <div className="flex items-center gap-2">
                              <input className="border rounded-md px-2 py-1 flex-1" placeholder="https://...ics" value={connectUrl} onChange={e=>setConnectUrl(e.target.value)} />
                              <button className="btn btn-primary" onClick={async ()=>{
                                if (!connectUrl) return;
                                try {
                                  const data = await apiCreateSource(selectedPerson!, showConnect!, connectUrl);
                                  if (data?.source) setSources(prev => [data.source, ...prev]);
                                } finally {
                                  setShowConnect(null); setConnectUrl('');
                                }
                              }}>Connect</button>
                              <button className="btn btn-ghost" onClick={()=> setShowConnect(null)}>Cancel</button>
                            </div>
                            <div className="text-[11px] opacity-60 mt-1">Tip: enable public sharing in your calendar/to-do app to obtain an ICS URL.</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button className="btn btn-primary inline-flex items-center gap-1" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/ms/start?provider=ms_graph_calendar&personId=${selectedPerson}`, '_blank', 'width=600,height=700') }>
                                <Calendar size={14} /> Connect Outlook Calendar (OAuth)
                              </button>
                              <button className="btn btn-primary inline-flex items-center gap-1" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/ms/start?provider=ms_graph_todo&personId=${selectedPerson}`, '_blank', 'width=600,height=700') }>
                                <ListPlus size={14} /> Connect Microsoft To Do (OAuth)
                              </button>
                              <button className="btn btn-primary inline-flex items-center gap-1" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/google/start?provider=google_calendar&personId=${selectedPerson}`, '_blank', 'width=600,height=700') }>
                                <Calendar size={14} className="text-[#4285F4]" /> Connect Google Calendar (OAuth)
                              </button>
                              <button className="btn btn-primary inline-flex items-center gap-1" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/google/start?provider=google_tasks&personId=${selectedPerson}`, '_blank', 'width=600,height=700') }>
                                <ListPlus size={14} className="text-[#34A853]" /> Connect Google Tasks (OAuth)
                              </button>
                            </div>
                          </div>
                        )}
                        {sources.length>0 && (
                          <div className="mt-2 space-y-1">
                            {sources.map(s => (
                              <div key={s.id} className="flex items-center justify-between text-xs">
                                <span className="truncate">{s.provider.replace('_',' ')}: {s.url}</span>
                                <button className="btn btn-ghost" onClick={async ()=>{
                                  await apiSyncSource(s.id);
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
                </motion.div>
              )}
            </AnimatePresence>
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
            <button onClick={() => { setMiniSelected(null); setAnchor(new Date()); }} className="px-3 py-1.5" title="Today"><Calendar size={16} /></button>
            <button onClick={() => changeAnchor(1)} className="px-3 py-1.5" title="Next"><ChevronRight size={16} /></button>
          </div>
          <div className="text-sm opacity-70 flex items-center gap-2"><Clock size={14} /> {anchorLabel}</div>
          <div className="inline-flex rounded-lg border overflow-hidden bg-white/60 dark:bg-black/30 backdrop-blur-sm ml-auto">
            {(['manual','priority','due'] as SortMode[]).map(m => (
              <button key={m} onClick={()=> setSortMode(m)} className={`px-3 py-1.5 capitalize transition-colors ${sortMode===m? 'bg-black text-white dark:bg-white dark:text-black':''}`}
                title={m==='manual' ? 'Manual order' : (m==='priority' ? 'Sort by priority' : 'Sort by due date')}>{m}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 min-w-[180px]">
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
              await apiUpdateTask(id, { due_time: hhmm });
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
                await apiUpdateTask(id, { bucket_type: 'day', bucket_date: dateStr, sort: baseNext + i });
              }
            }}
            onReorderDay={onReorderDay}
            onReorderPeriod={async (periodKey, ids)=>{
              await onReorderPeriod(periodKey, ids);
            }}
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
            sortMode={sortMode}
          />
        ) : (
          <div className="space-y-8">
            {grouped.days.length === 0 && (
              <div className="opacity-60">No tasks yet. Add one below.</div>
            )}
            <AnimatePresence initial={false}>
              {grouped.days.map(([date, items]) => {
                const safeItems = (items || []).filter(Boolean) as Task[];
                const allIds = safeItems.map(t => t.id);
                const reorderEnabled = sortMode === 'manual';
                return (
                <motion.section key={date} layout initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}}>
                  <h3 className="font-medium mb-3 flex items-center gap-2"><Calendar size={14} /> {date}</h3>
                  {reorderEnabled ? (
                    <Reorder.Group as="div" axis="y" values={allIds} onReorder={(ids) => onReorderDay(date, ids as number[])}>
                      <AnimatePresence initial={false}>
                        {safeItems.map(task => (
                          <ReorderableRow key={task.id} valueId={task.id}>
                            {(start)=> (
                              <TaskRow task={task} selected={selected.has(task.id)} accentColor={accentFor(task)} prefs={prefs}
                                onSelect={(id,e)=>{
                                  setSelected(prev => {
                                    const next = new Set(prev);
                                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                      if (next.has(id)) next.delete(id); else next.add(id);
                                    } else { next.clear(); next.add(id); }
                                    return next;
                                  });
                                }} onToggle={() => toggleDone(task, date)} onDelete={() => deleteTask(task)}
                                personName={personById.get(task.person_id || -1)?.name}
                                personColor={personById.get(task.person_id || -1)?.color || personColorMap.get(task.person_id || -1)}
                                onReorderHandleDown={start}
                                instanceDone={task.recurrence !== 'none' ? (doneByDate.get(date)?.has(task.id) || false) : (task.status==='done')}
                              />
                            )}
                          </ReorderableRow>
                        ))}
                      </AnimatePresence>
                    </Reorder.Group>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {safeItems.map(task => (
                        <TaskRow key={task.id} task={task} selected={selected.has(task.id)} accentColor={accentFor(task)} prefs={prefs}
                          onSelect={(id,e)=>{
                            setSelected(prev => {
                              const next = new Set(prev);
                              if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                if (next.has(id)) next.delete(id); else next.add(id);
                              } else { next.clear(); next.add(id); }
                              return next;
                            });
                          }} onToggle={() => toggleDone(task, date)} onDelete={() => deleteTask(task)}
                          personName={personById.get(task.person_id || -1)?.name}
                          personColor={personById.get(task.person_id || -1)?.color || personColorMap.get(task.person_id || -1)}
                          instanceDone={task.recurrence !== 'none' ? (doneByDate.get(date)?.has(task.id) || false) : (task.status==='done')}
                        />
                      ))}
                    </div>
                  )}
                 </motion.section>
               );})}
            </AnimatePresence>
          </div>
        )}
      </main>
      <Composer
        people={people}
        view={view}
        anchor={anchor}
        onSubmit={async (payload) => {
          try {
            const data = await apiCreateTask(payload);
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

function TaskRow({ task, onToggle, onDelete, selected=false, onSelect, accentColor, personName, personColor, prefs, onReorderHandleDown, instanceDone }: { task: Task; onToggle: () => void; onDelete: () => void; selected?: boolean; onSelect?: (id:number, e: React.MouseEvent)=>void; accentColor?: string; personName?: string; personColor?: string; prefs: UserPrefs; onReorderHandleDown?: (e:any)=>void; instanceDone?: boolean; }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(task.due_date || '');
  const [dueTime, setDueTime] = useState(task.due_time || '');
  const [color, setColor] = useState<string | null>(task.color || null);
  const [priority, setPriority] = useState<number>(task.priority ?? 0);
  const saving = useRef(false);
  async function save() {
    saving.current = true;
    await apiUpdateTask(task.id, { title, due_date: due || null, due_time: dueTime || null, color, priority });
    setEditing(false);
    saving.current = false;
  }
  const accent = accentColor || (color || task.color) || hashToHsl(task.person_id ?? task.id);
  const accentAlpha = withAlpha(accent, 0.3);
  const isDone = instanceDone ?? (task.status === 'done');
  return (
    <motion.div layout initial={{opacity:0, scale:0.98}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.98}} transition={{type:'spring', stiffness:300, damping:24}}
      className={`card p-3 flex items-center gap-3 ${selected ? 'ring-2 ring-black/40 dark:ring-white/40' : ''}`}
      style={{boxShadow: `inset 0 0 0 2px ${accentAlpha}`}}
      onMouseDown={(e)=> onSelect?.(task.id, e)}
    >
      {onReorderHandleDown && (
        <span className="cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100" title="Reorder"
          onPointerDown={(e)=>{ e.stopPropagation(); onReorderHandleDown?.(e); }}>
          <GripVertical size={14} />
        </span>
      )}
      <button onClick={onToggle} className={`size-5 rounded grid place-items-center border transition-colors ${isDone ? 'bg-emerald-500 text-white border-emerald-600' : 'hover:bg-black/5 dark:hover:bg-white/10'}`} title="Toggle done">
        {isDone ? <Check size={14}/> : null}
      </button>
      <div className="flex-1 min-w-0">
        {!editing ? (
          <div>
            <div className={`font-medium truncate ${isDone ? 'line-through opacity-60' : ''}`}>{task.title}</div>
            <div className="text-xs opacity-70 flex gap-3 items-center flex-wrap">
              {task.due_date && (
                <span className={`chip flex items-center gap-1 ${isOverdue(task) ? 'bg-rose-500/15 text-rose-700 border-rose-600/30' : ''}`}>
                  <Clock size={12}/> {formatDueLabel(task, prefs)}
                  {isOverdue(task) && <span className="ml-1">Overdue</span>}
                </span>
              )}
              <span className={`chip border ${statusColor(isDone ? 'done' : task.status)}`}>{(isDone ? 'done' : task.status).replace('_',' ')}</span>
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

// MiniCalendar component moved to '@/components/MiniCalendar'

function CalendarGrid({ view, anchor, grouped, onDropTask, onReorderDay, onReorderPeriod, isSelected, onSelect, accentFor, personById, personColorMap, prefs, sortMode }: { view: View; anchor: Date; grouped: { start: Date; end: Date; days: [string, Task[]][] }; onDropTask: (taskIds: number[], dateStr: string) => void | Promise<void>; onReorderDay: (dateKey: string, reorderedIds: number[]) => void | Promise<void>; onReorderPeriod: (periodKey: string, reorderedIds: number[]) => void | Promise<void>; isSelected: (id: number)=>boolean; onSelect: (id: number, e: React.MouseEvent) => void; accentFor: (t: Task) => string; personById: Map<number, Person>; personColorMap: Map<number, string>; prefs: UserPrefs; sortMode: 'manual'|'priority'|'due'; }) {
  const start = view === 'week' ? startOfWeek(anchor) : startOfMonth(anchor);
  const startGrid = view === 'week' ? start : startOfWeek(new Date(start.getFullYear(), start.getMonth(), 1));
  const cells: Date[] = [];
  const total = view === 'week' ? 7 : 42;
  for (let i=0;i<total;i++) cells.push(addDays(startGrid, i));
  const map = new Map(grouped.days);
  const [overKey, setOverKey] = useState<string | null>(null);
  const isSameDay = (a: Date, b: Date) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
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
  const periodKey = formatISODate(start);
  const reorderEnabled = sortMode === 'manual';
  return (
    <div className="card p-2">
      <div className="grid grid-cols-7 gap-2">
        {banners.length > 0 && (
          <div className="col-span-7 mb-1">
            {reorderEnabled ? (
              <Reorder.Group as="div" axis="x" values={banners.sort((a,b)=> (a.sort??0)-(b.sort??0)).map(t=>t.id)} onReorder={(ids)=> onReorderPeriod(periodKey, ids as number[])}>
                <div className="flex flex-wrap gap-2">
                  {banners.sort((a,b)=> (a.sort??0)-(b.sort??0)).map(t => (
                    <Reorder.Item as="div" key={t.id} value={t.id} dragListener={true}>
                      <div className="text-[12px] px-3 py-1 rounded-md border bg-white/70 dark:bg-black/40 backdrop-blur-sm cursor-grab active:cursor-grabbing" style={{borderColor: accentFor(t)}}>
                        <span className="size-2 inline-block rounded-full mr-1 align-middle" style={{background: accentFor(t)}}></span>
                        {t.title}
                      </div>
                    </Reorder.Item>
                  ))}
                </div>
              </Reorder.Group>
            ) : (
              <div className="flex flex-wrap gap-2">
                {banners
                  .slice()
                  .sort((a,b)=>{
                    if (sortMode==='priority') return (b.priority||0)-(a.priority||0);
                    if (sortMode==='due') {
                      const da = parseDueDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
                      const db = parseDueDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
                      return da - db;
                    }
                    return (a.sort??0)-(b.sort??0);
                  })
                  .map(t => (
                  <div key={t.id} className="text-[12px] px-3 py-1 rounded-md border bg-white/70 dark:bg-black/40 backdrop-blur-sm" style={{borderColor: accentFor(t)}}>
                    <span className="size-2 inline-block rounded-full mr-1 align-middle" style={{background: accentFor(t)}}></span>
                    {t.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d)=> (
          <div key={d} className="text-[11px] opacity-60 px-1">{d}</div>
        ))}
        {cells.map((d, idx) => {
          const key = formatISODate(d);
          const recurring = (map.get(key) || []).filter(t => t.recurrence !== 'none');
          const dayItems = (map.get(key) || []).filter(t => t && t.recurrence === 'none' && t.bucket_type === 'day');
          const dim = view==='month' && d.getMonth() !== start.getMonth();
          const isToday = isSameDay(d, new Date(today.getFullYear(), today.getMonth(), today.getDate()));
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
                <span>{d.getDate()}</span>
                {isToday && <span className="size-1.5 rounded-full bg-emerald-500"></span>}
              </div>
              {sortMode==='manual' ? (
              <Reorder.Group as="div" axis="y" values={dayItems.map(t=>t.id)} onReorder={(ids) => onReorderDay(key, ids as number[])}>
                <div className="flex flex-col gap-1">
                  {dayItems.map(t => (
                    <ReorderableChip key={t.id} task={t} valueId={t.id}>
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
              ) : (
                <div className="flex flex-col gap-1">
                  {dayItems.map(t => (
                    <TaskChip key={t.id} task={t} accentColor={accentFor(t)} selected={isSelected(t.id)} onSelect={onSelect}
                      personName={(t.person_id!=null? personById.get(t.person_id||-1)?.name: undefined)}
                      personColor={(t.person_id!=null? (t.person_id!=null? (personById.get(t.person_id||-1)?.color || personColorMap.get(t.person_id||-1)) : undefined) : undefined)}
                      prefs={prefs}
                    />
                  ))}
                  {recurring.map(t => (
                    <TaskChip key={`r-${t.id}`} task={t} accentColor={accentFor(t)} selected={isSelected(t.id)} onSelect={onSelect}
                      personName={(t.person_id!=null? personById.get(t.person_id||-1)?.name: undefined)}
                      personColor={(t.person_id!=null? (personById.get(t.person_id||-1)?.color || personColorMap.get(t.person_id||-1)) : undefined)}
                      prefs={prefs}
                    />
                  ))}
                </div>
              )}
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

function ReorderableChip({ task, children, valueId }: { task: Task; children: (start:(e:any)=>void)=>React.ReactNode; valueId: number }) {
  const controls = useDragControls();
  return (
    <Reorder.Item as="div" value={valueId} dragListener={false} dragControls={controls}>
      {children((e:any)=> controls.start(e))}
    </Reorder.Item>
  );
}

function ReorderableRow({ valueId, children }: { valueId: number; children: (start:(e:any)=>void)=>React.ReactNode; }) {
  const controls = useDragControls();
  // On touch devices, require a longer press before starting drag to avoid scroll conflicts.
  const startWithDelay = (downEvent: any) => {
    const isTouch = (downEvent?.pointerType === 'touch') || ('ontouchstart' in window);
    if (!isTouch) return controls.start(downEvent);
    let started = false;
    const timer = setTimeout(() => { started = true; controls.start(downEvent); }, 180);
    const clear = () => { if (!started) clearTimeout(timer); window.removeEventListener('pointerup', clear, { capture: true } as any); window.removeEventListener('pointercancel', clear, { capture: true } as any); };
    window.addEventListener('pointerup', clear, { capture: true } as any);
    window.addEventListener('pointercancel', clear, { capture: true } as any);
  };
  return (
    <Reorder.Item as="div" value={valueId} dragListener={false} dragControls={controls}>
      {children(startWithDelay)}
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
    await apiDeletePerson(person.id);
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
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    try { setCoarse(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch {}
  }, []);
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
            <TimelineDraggableItem key={t.id} y={initialY} left={left} color={accent} selected={isSelected(t.id)} coarse={coarse}
              onSelect={(e)=> onSelect(t.id, e)}
              onEnd={(y)=>{
                const cy = clampY(y);
                const mins = Math.round((cy / hourHeight) * 60 / 5) * 5; // 5-min steps
                onChangeTime(t.id, minutesToHHMM(mins));
              }}
              title={t.title}
              time={t.due_time || '—'}
            />
          );
        })}
      </div>
    </div>
  );
}

function TimelineDraggableItem({ y, left, color, selected, onSelect, onEnd, title, time, coarse }:{ y:number; left:number; color:string; selected:boolean; onSelect:(e:any)=>void; onEnd:(y:number)=>void; title:string; time:string; coarse:boolean; }){
  const controls = useDragControls();
  const start = (e:any)=> controls.start(e);
  const handlePointerDown = (e:any)=>{
    e.stopPropagation();
    const isTouch = (e?.pointerType === 'touch') || ('ontouchstart' in window);
    if (!isTouch) return start(e);
    // long-press on touch
    let started = false;
    const timer = setTimeout(()=> { started = true; start(e); }, 200);
    const clear = ()=>{ if(!started) clearTimeout(timer); window.removeEventListener('pointerup', clear, {capture:true} as any); window.removeEventListener('pointercancel', clear, {capture:true} as any); };
    window.addEventListener('pointerup', clear, {capture:true} as any);
    window.addEventListener('pointercancel', clear, {capture:true} as any);
  };
  return (
    <motion.div drag={coarse ? false : 'y'} dragControls={controls} dragListener={false} dragConstraints={{ top: 0, bottom: Infinity }}
      initial={false}
      className={`absolute right-2 rounded-md border px-2 py-1 text-[12px] bg-white/70 dark:bg-black/40 backdrop-blur-sm ${selected?'ring-2 ring-black/40 dark:ring-white/40':''}`}
      style={{ top: y, left, borderColor: color, touchAction: 'pan-y' as any }}
      onMouseDown={onSelect}
      onDragEnd={(_, info)=> onEnd(info.point.y)}
    >
      <div className="flex items-center gap-2">
        <span className="cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100" onPointerDown={handlePointerDown} title="Drag">
          <GripVertical size={12} />
        </span>
        <span className="size-2 rounded-full" style={{background: color}}></span>
        <span className={`truncate ${selected ? '' : ''} ${/* preserve done styling externally if desired */''}`}>{title}</span>
        <span className="ml-auto text-[10px] opacity-60">{time}</span>
      </div>
    </motion.div>
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
    apiGetSources(person.id).then(d=> setSources(d.sources||[])).catch(()=>setSources([]));
  }, [person.id]);

  async function save() {
    const data = await apiUpdatePerson(person.id, { name, color });
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
              <button className="btn btn-ghost inline-flex items-center gap-1" onClick={()=>{ setShowConnect('apple_calendar'); setConnectUrl(''); }}>
                <Apple size={14} /> Apple Calendar (ICS)
              </button>
              <button className="btn btn-ghost inline-flex items-center gap-1" onClick={()=>{ setShowConnect('apple_reminders'); setConnectUrl(''); }}>
                <Apple size={14} /> Apple Reminders (ICS)
              </button>
              <button className="btn btn-ghost inline-flex items-center gap-1" onClick={()=>{ setShowConnect('outlook_calendar'); setConnectUrl(''); }}>
                <Calendar size={14} className="text-[#0078D4]" /> Outlook Calendar (ICS)
              </button>
              <button className="btn btn-ghost inline-flex items-center gap-1" onClick={()=>{ setShowConnect('microsoft_todo'); setConnectUrl(''); }}>
                <ListPlus size={14} className="text-[#2564EB]" /> Microsoft To Do (ICS)
              </button>
              <button className="btn btn-primary inline-flex items-center gap-1" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/ms/start?provider=ms_graph_calendar&personId=${person.id}`, '_blank', 'width=600,height=700') }>
                <Calendar size={14} /> Connect Outlook Calendar (OAuth)
              </button>
              <button className="btn btn-primary inline-flex items-center gap-1" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/ms/start?provider=ms_graph_todo&personId=${person.id}`, '_blank', 'width=600,height=700') }>
                <ListPlus size={14} /> Connect Microsoft To Do (OAuth)
              </button>
              <button className="btn btn-primary inline-flex items-center gap-1" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/google/start?provider=google_calendar&personId=${person.id}`, '_blank', 'width=600,height=700') }>
                <Calendar size={14} className="text-[#4285F4]" /> Connect Google Calendar (OAuth)
              </button>
              <button className="btn btn-primary inline-flex items-center gap-1" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/google/start?provider=google_tasks&personId=${person.id}`, '_blank', 'width=600,height=700') }>
                <ListPlus size={14} className="text-[#34A853]" /> Connect Google Tasks (OAuth)
              </button>
            </div>
            {showConnect && (
              <div className="popover mt-2">
                <div className="text-xs opacity-70 mb-1">Paste public ICS URL for {showConnect.replace('_',' ')}</div>
                <div className="flex items-center gap-2">
                  <input className="border rounded-md px-2 py-1 flex-1" placeholder="https://...ics" value={connectUrl} onChange={e=>setConnectUrl(e.target.value)} />
                  <button className="btn btn-primary" onClick={async ()=>{
                    if (!connectUrl) return;
                    try {
                      const data = await apiCreateSource(person.id, showConnect!, connectUrl);
                      if (data?.source) setSources(prev => [data.source, ...prev]);
                    } finally {
                      setShowConnect(null); setConnectUrl('');
                    }
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
                          const data = await apiUpdateSource(s.id, { url: editingSourceUrl || null });
                          if (data?.source) setSources(prev => prev.map(x => x.id===s.id ? data.source : x));
                          setEditingSourceId(null); setEditingSourceUrl('');
                        }}>Save</button>
                        <button className="btn btn-ghost" onClick={()=>{ setEditingSourceId(null); setEditingSourceUrl(''); }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-ghost" onClick={async ()=>{
                          await apiSyncSource(s.id);
                        }}>Sync now</button>
                        <button className="btn btn-ghost" onClick={()=>{ setEditingSourceId(s.id); setEditingSourceUrl(s.url || ''); }}>Edit</button>
                        <button className="btn btn-ghost text-red-600" onClick={async ()=>{
                          await apiDeleteSource(s.id);
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
  const [endMode, setEndMode] = useState<'none'|'on_date'>('none');
  const [untilDate, setUntilDate] = useState<string>('');
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
    if (recurrence !== 'none') {
      payload.until = endMode === 'on_date' && untilDate ? untilDate : null;
    }
    if (priority || parsed.priority) payload.priority = priority || parsed.priority;
    await onSubmit(payload);
    setTitle(""); setDue(""); setDueTime(""); setByweekday([]); setColor(null); setPriority(0); setEndMode('none'); setUntilDate('');
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
              {recurrence!=='none' && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs opacity-70">Ends</span>
                  <label className="text-xs inline-flex items-center gap-1">
                    <input type="radio" name="end" checked={endMode==='none'} onChange={()=> setEndMode('none')} /> No end
                  </label>
                  <label className="text-xs inline-flex items-center gap-1">
                    <input type="radio" name="end" checked={endMode==='on_date'} onChange={()=> setEndMode('on_date')} /> On date
                  </label>
                  {endMode==='on_date' && (
                    <input type="date" value={untilDate} onChange={e=> setUntilDate(e.target.value)} className="border rounded-md px-2 py-1" />
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
}
