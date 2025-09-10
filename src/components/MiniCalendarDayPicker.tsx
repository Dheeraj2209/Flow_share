"use client";

import { useMemo, useState } from 'react';
import { DayPicker } from 'react-day-picker';

export default function MiniCalendarDayPicker({ value, onChange }: { value: Date; onChange: (d: Date) => void; }) {
  const [month, setMonth] = useState(new Date(value.getFullYear(), value.getMonth(), 1));
  const today = useMemo(() => new Date(), []);

  return (
    <div className="card p-3">
      <DayPicker
        month={month}
        onMonthChange={setMonth}
        showOutsideDays
        captionLayout="buttons"
        selected={undefined}
        mode="single"
        onDayClick={(day) => onChange(day)}
        modifiers={{ today }}
        modifiersClassNames={{
          // Shade only today
          today: 'bg-white text-black dark:bg-white dark:text-black',
          // Dim outside days
          outside: 'opacity-40 hover:opacity-60',
        }}
        className="text-[12px]"
        classNames={{
          months: 'flex',
          month: 'w-full',
          caption: 'flex justify-between items-center mb-2',
          caption_label: 'text-sm font-medium',
          nav: 'flex items-center gap-2',
          button_previous: 'btn btn-ghost',
          button_next: 'btn btn-ghost',
          table: 'w-full border-separate border-spacing-1',
          head_row: 'text-[11px] opacity-60',
          head_cell: 'text-center',
          row: '',
          cell: '',
          day: '',
          day_button: 'aspect-square w-full rounded-md border bg-transparent hover:bg-black/5 dark:hover:bg-white/10',
        }}
      />
    </div>
  );
}
