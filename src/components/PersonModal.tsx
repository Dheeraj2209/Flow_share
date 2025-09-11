"use client";
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalSource, Person } from '@/types';
import ColorDots from '@/components/ColorDots';
import { createSource as apiCreateSource, updateSource as apiUpdateSource, deleteSource as apiDeleteSource, getSources as apiGetSources, syncSource as apiSyncSource, updatePerson as apiUpdatePerson } from '@/services/api';

export default function PersonModal({ person, onClose, onSaved }: { person: Person; onClose: ()=>void; onSaved: (p: Person)=>void; }) {
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
    if ((data as any)?.person) onSaved((data as any).person);
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
              <button className="btn btn-primary" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/ms/start?provider=ms_graph_calendar&personId=${person.id}`, '_blank', 'width=600,height=700') }>Connect Outlook Calendar (OAuth)</button>
              <button className="btn btn-primary" onClick={()=> window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/oauth/ms/start?provider=ms_graph_todo&personId=${person.id}`, '_blank', 'width=600,height=700') }>Connect Microsoft To Do (OAuth)</button>
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
                      if ((data as any)?.source) setSources(prev => [(data as any).source, ...prev]);
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
                          if ((data as any)?.source) setSources(prev => prev.map(x => x.id===s.id ? (data as any).source : x));
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

