'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, formatLocalYearMonth, startOfMonth, startOfWeek, dateKeyInZone } from '@/lib/date';

export default function MiniCalendar({ value, onChange }: { value: Date; onChange: (d: Date) => void; }) {
  // Visible month anchor (first of month)
  const [month, setMonth] = useState(new Date(value.getFullYear(), value.getMonth(), 1));
  // Keyboard navigation cursor (defaults to current value)
  const [cursor, setCursor] = useState<Date>(new Date(value));
  const containerRef = useRef<HTMLDivElement | null>(null);

  // keep cursor/month in sync when external value changes
  useEffect(() => {
    setCursor(new Date(value));
    setMonth(new Date(value.getFullYear(), value.getMonth(), 1));
  }, [value]);

  const start = startOfMonth(month);
  const startGrid = startOfWeek(new Date(start.getFullYear(), start.getMonth(), 1));
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(startGrid, i));
  const sameMonth = (d: Date) => d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
  const selectedKey = dateKeyInZone(value);
  const cursorKey = dateKeyInZone(cursor);
  const todayKey = dateKeyInZone(new Date());

  function changeMonth(delta: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next);
  }

  function setCursorSmart(next: Date) {
    setCursor(next);
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    }
  }

  function moveCursor(days: number) {
    const next = addDays(cursor, days);
    setCursorSmart(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); moveCursor(-1); break;
      case 'ArrowRight': e.preventDefault(); moveCursor(1); break;
      case 'ArrowUp': e.preventDefault(); moveCursor(-7); break;
      case 'ArrowDown': e.preventDefault(); moveCursor(7); break;
      case 'PageUp': e.preventDefault(); changeMonth(-1); break;
      case 'PageDown': e.preventDefault(); changeMonth(1); break;
      case 'Home': {
        e.preventDefault();
        const next = startOfWeek(cursor);
        setCursorSmart(next);
        break;
      }
      case 'End': {
        e.preventDefault();
        const next = addDays(startOfWeek(cursor), 6);
        setCursorSmart(next);
        break;
      }
      case 'Enter':
      case ' ': // space
        e.preventDefault();
        onChange(cursor);
        break;
    }
  }

  return (
    <div
      ref={containerRef}
      className="card p-3"
      tabIndex={0}
      role="grid"
      aria-label="Mini calendar"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center justify-between mb-2">
        <button
          className="btn btn-ghost"
          onClick={() => changeMonth(-1)}
          aria-label="Previous month"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="text-sm font-medium" aria-live="polite">{formatLocalYearMonth(month)}</div>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost"
            onClick={() => setMonth(new Date())}
            title="Jump to current month"
          >
            Today
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => changeMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-[11px] opacity-60 mb-1 select-none">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} className="text-center" role="columnheader">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="rowgroup">
        {cells.map((d, i) => {
          const cellKey = dateKeyInZone(d);
          const isActive = cellKey === selectedKey;
          const isToday = cellKey === todayKey;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6; // Sun/Sat
          const isCursor = cellKey === cursorKey;

          let className = 'aspect-square rounded-md text-[12px] grid place-items-center border border-black/10 dark:border-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-black/30 dark:focus:ring-white/30 ';

          if (isActive) {
            // Primary inversion for visibility in both themes
            className += 'bg-black text-white dark:bg-white dark:text-black border-transparent shadow-sm ';
          } else {
            if (!sameMonth(d)) {
              className += 'opacity-40 ';
            }
            if (isToday) {
              className += 'ring-1 ring-black/30 dark:ring-white/30 ';
            }
            if (isCursor && !isActive && !isToday) {
              className += 'ring-1 ring-black/20 dark:ring-white/20 ';
            }
            // Subtle weekend tint for same-month non-active cells
            if (isWeekend && sameMonth(d)) {
              className += 'bg-black/[0.03] dark:bg-white/[0.04] ';
            }
            className += 'hover:bg-black/5 dark:hover:bg-white/10 ';
          }

          return (
            <button
              key={i}
              onClick={() => onChange(d)}
              className={className}
              role="gridcell"
              aria-selected={isActive}
              aria-current={isToday ? 'date' : undefined}
              title={d.toDateString()}
            >
              <span>{d.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
