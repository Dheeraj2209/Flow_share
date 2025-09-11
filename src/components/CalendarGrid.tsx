"use client";
import React, { useMemo, useState } from 'react';
import { Reorder, useDragControls, motion } from 'framer-motion';
import { Clock, GripVertical } from 'lucide-react';
import { Task, Person, UserPrefs, View } from '@/types';
import { addDays, formatISODate, isSameDay, startOfMonth, startOfWeek } from '@/lib/date';
import { hashToHsl, priorityClass } from '@/lib/colors';

function ReorderableChip({ task, children, valueId }: { task: Task; children: (start:(e:any)=>void)=>React.ReactNode; valueId: number }) {
  const controls = useDragControls();
  return (
    <Reorder.Item as="div" value={valueId} dragListener={false} dragControls={controls}>
      {children((e:any)=> controls.start(e))}
    </Reorder.Item>
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
        <span className={`ml-auto text-[10px] flex items-center gap-1 opacity-70`}>
          <Clock size={10}/>{task.due_time}
        </span>
      )}
      <span
        className="ml-1 cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100"
        title="Drag to another day"
        draggable onDragStart={(e)=>{
          let payload: any = { ids: [task.id] };
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

export default function CalendarGrid({ view, anchor, grouped, onDropTask, onReorderDay, onReorderPeriod, isSelected, onSelect, accentFor, personById, personColorMap, prefs, sortMode }: { view: View; anchor: Date; grouped: { start: Date; end: Date; days: [string, Task[]][] }; onDropTask: (taskIds: number[], dateStr: string) => void | Promise<void>; onReorderDay: (dateKey: string, reorderedIds: number[]) => void | Promise<void>; onReorderPeriod: (periodKey: string, reorderedIds: number[]) => void | Promise<void>; isSelected: (id: number)=>boolean; onSelect: (id: number, e: React.MouseEvent) => void; accentFor: (t: Task) => string; personById: Map<number, Person>; personColorMap: Map<number, string>; prefs: UserPrefs; sortMode: 'manual'|'priority'|'due'; }) {
  const start = view === 'week' ? startOfWeek(anchor) : startOfMonth(anchor);
  const startGrid = view === 'week' ? start : startOfWeek(new Date(start.getFullYear(), start.getMonth(), 1));
  const cells: Date[] = useMemo(() => {
    const arr: Date[] = [];
    const len = view === 'week' ? 7 : 42;
    for (let i=0;i<len;i++) arr.push(addDays(startGrid, i));
    return arr;
  }, [startGrid, view]);
  const map = useMemo(() => new Map(grouped.days), [grouped]);
  const today = new Date();
  const [overKey, setOverKey] = useState<string | null>(null);
  return (
    <div className="card p-3">
      <div className={`grid ${view==='week' ? 'grid-cols-7' : 'grid-cols-7'} gap-2`}>
        {view==='month' && (
          <div className="col-span-7">
            <div className="text-[11px] opacity-60 grid grid-cols-7">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d)=> (
                <div key={d} className="px-1">{d}</div>
              ))}
            </div>
          </div>
        )}
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

