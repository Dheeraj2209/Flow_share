"use client";

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, formatLocalYearMonth, startOfMonth, startOfWeek } from '@/lib/date';

export default function MiniCalendar({ value, onChange }: { value: Date; onChange: (d: Date) => void; }) {
  const month = useMemo(() => new Date(value.getFullYear(), value.getMonth(), 1), [value]);
  const today = new Date();
  const start = startOfMonth(month);
  const startGrid = startOfWeek(new Date(start.getFullYear(), start.getMonth(), 1));
  const cells: Date[] = [];
  for (let i=0;i<42;i++) cells.push(addDays(startGrid, i));
  const isSameDay = (a: Date, b: Date) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  const sameMonth = (d: Date) => d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <button className="btn btn-ghost" onClick={() => onChange(new Date(month.getFullYear(), month.getMonth()-1, value.getDate()))}><ChevronLeft size={14}/></button>
        <div className="text-sm font-medium">{formatLocalYearMonth(month)}</div>
        <button className="btn btn-ghost" onClick={() => onChange(new Date(month.getFullYear(), month.getMonth()+1, value.getDate()))}><ChevronRight size={14}/></button>
      </div>
      <div className="grid grid-cols-7 text-[11px] opacity-60 mb-1">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d,i) => {
          const isToday = isSameDay(d, new Date(today.getFullYear(), today.getMonth(), today.getDate()));
          const selected = isSameDay(d, value);
          return (
            <button key={i} onClick={() => onChange(d)} className={`aspect-square rounded-md text-[12px] grid place-items-center border transition-colors ${selected ? 'bg-white text-black' : sameMonth(d) ? 'hover:bg-black/5 dark:hover:bg-white/10' : 'opacity-40 hover:opacity-60 hover:bg-black/5 dark:hover:bg-white/10'}`}>
              <span className={`${isToday && !selected ? 'underline' : ''}`}>{d.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

