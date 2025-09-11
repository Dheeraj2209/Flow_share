"use client";
import React from 'react';
import { motion } from 'framer-motion';
import { Pencil, Trash2 } from 'lucide-react';
import { Person } from '@/types';
import { hashToHsl } from '@/lib/colors';
import { deletePerson as apiDeletePerson } from '@/services/api';

export default function PersonRow({ person, active, onSelect, progress, onUpdated, onDeleted, onEdit }: { person: Person; active: boolean; onSelect: () => void; progress: {done:number,total:number}; onUpdated: (p: Person)=>void; onDeleted: ()=>void; onEdit: ()=>void; }) {
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
        <div className="flex items-center gap-2 text-[10px] min-w-0 w-full">
          <div className={`flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden`}>
            <div className="h-full" style={{width: `${progress.total>0? Math.round((progress.done/progress.total)*100):0}%`, background: color}}></div>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

