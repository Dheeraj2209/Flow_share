"use client";
import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { Task, UserPrefs } from '@/types';
import { hashToHsl, priorityClass, statusColor, withAlpha } from '@/lib/colors';
import { formatDateLocal, formatTimeLocal, isOverdueDate, parseDueDate as parseDueDateUtil } from '@/lib/date';
import { updateTask as apiUpdateTask } from '@/services/api';
import ColorDots from '@/components/ColorDots';

function parseDueDate(task: Task): Date | null {
  return parseDueDateUtil(task.due_date, task.due_time);
}
function isOverdue(task: Task): boolean {
  if (task.status === 'done') return false;
  return isOverdueDate(parseDueDate(task));
}
function formatDueLabel(task: Task, prefs: UserPrefs) {
  if (!task.due_date && !task.due_time) return '';
  const dateStr = task.due_date || '';
  const timeStr = task.due_time && /^\d{2}:\d{2}$/.test(task.due_time) ? task.due_time : undefined;
  const local = dateStr ? new Date(`${dateStr}T${timeStr || '00:00'}:00`) : new Date();
  const datePart = dateStr ? formatDateLocal(local, prefs) : '';
  const timePart = timeStr ? formatTimeLocal(local, prefs) : '';
  return `${datePart}${datePart && timePart ? ' ' : ''}${timePart}`;
}

export default function TaskRow({ task, onToggle, onDelete, selected=false, onSelect, accentColor, personName, personColor, prefs, onReorderHandleDown, instanceDone }: { task: Task; onToggle: () => void; onDelete: () => void; selected?: boolean; onSelect?: (id:number, e: React.MouseEvent)=>void; accentColor?: string; personName?: string; personColor?: string; prefs: UserPrefs; onReorderHandleDown?: (e:any)=>void; instanceDone?: boolean; }) {
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
              {task.recurrence !== 'none' && <span className="chip flex items-center gap-1">Recurring</span>}
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

