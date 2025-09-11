"use client";
import React from 'react';

export default function ColorDots({ value, onChange }: { value: string | null; onChange: (v: string | null) => void; }) {
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

