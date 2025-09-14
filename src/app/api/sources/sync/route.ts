import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import ical from 'node-ical';
import { corsHeaders, preflight } from '@/lib/cors';
import { broadcast } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ICalEvent = { type?: string; summary?: string; start?: Date; uid?: string };
type TaskImport = { title: string; due_date: string; due_time: string; external_id: string };
type RowId = { id?: number };

type DbExternalSource = {
  id: number;
  person_id: number;
  provider: string;
  url?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  scope?: string | null;
  account?: string | null;
};

type MsTodoLists = { value?: Array<{ id: string; displayName?: string }>};
type MsTodoItems = { value?: Array<{ id: string; title?: string; dueDateTime?: { dateTime?: string; timeZone?: string } }>};
type MsEvents = { value?: Array<{ id: string; subject?: string; isAllDay?: boolean; start?: { dateTime?: string; timeZone?: string } }>};

// Google types
type GTaskLists = { items?: Array<{ id: string; title?: string }>};
type GTasks = { items?: Array<{ id: string; title?: string; due?: string }>};
type GEvents = { items?: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string } }>};

async function importICS(url: string, person_id: number, source_id: number) {
  const db = getDb();
  const data = (await ical.async.fromURL(url)) as Record<string, ICalEvent>;
  const tasks: TaskImport[] = [];
  for (const k in data) {
    const ev = data[k];
    if (ev.type !== 'VEVENT') continue;
    const title = String(ev.summary || 'Untitled').trim();
    const d = ev.start as Date | undefined;
    if (!d) continue;
    // Use local components to avoid UTC date shifting for all-day events
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const due_date = `${yyyy}-${mm}-${dd}`;
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    const due_time = `${hh}:${mi}`;
    const external_id = String(ev.uid || k);
    tasks.push({ title, due_date, due_time, external_id });
  }
  const insertSQL = `INSERT INTO tasks (title, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, sort, source_id, external_id)
    VALUES (?, ?, 'todo', ?, ?, 'day', ?, 'none', 1, 0, ?, ?)`;
  for (const t of tasks) {
    const existing = await db.get(`SELECT id FROM tasks WHERE source_id = ? AND external_id = ?`, [source_id, t.external_id]) as RowId | undefined;
    if (existing?.id) {
      await db.run(`UPDATE tasks SET title=?, due_date=?, due_time=?, bucket_type='day', bucket_date=? WHERE id = ?`, [t.title, t.due_date, t.due_time, t.due_date, existing.id]);
      const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [existing.id]);
      if (task) broadcast('task_updated', { task });
    } else {
      const info = await db.run(insertSQL, [t.title, person_id, t.due_date, t.due_time, t.due_date, source_id, t.external_id]);
      const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [info.lastInsertRowid as number]);
      if (task) broadcast('task_created', { task });
    }
  }
  return { imported: tasks.length };
}

export async function POST(req: NextRequest) {
  const db = getDb();
  let bodyUnknown: unknown;
  try { bodyUnknown = await req.json(); } catch { bodyUnknown = {}; }
  const source_idRaw = (bodyUnknown as { source_id?: unknown }).source_id;
  const source_id = source_idRaw != null ? Number(source_idRaw) : null;
  if (!source_id) return new Response('source_id required', { status: 400 });
  const src = await db.get(`SELECT * FROM external_sources WHERE id = ?`, [source_id]) as DbExternalSource | undefined;
  if (!src) return new Response('Source not found', { status: 404 });
  let result: { imported: number } = { imported: 0 };
  const exported = {
    google_tasks: { created: 0, updated: 0 },
    google_calendar: { created: 0, updated: 0 },
    ms_todo: { created: 0, updated: 0 },
    ms_calendar: { created: 0, updated: 0 },
  };
  if (src.provider === 'ms_graph_todo' || src.provider === 'ms_graph_calendar') {
    // Basic sync using stored access token; production should refresh when expired
    if (!src.access_token) return new Response('Not authorized', { status: 401 });
    const headers: HeadersInit = { Authorization: `Bearer ${src.access_token}` };
    if (src.provider === 'ms_graph_todo') {
      const lists: MsTodoLists = await fetch('https://graph.microsoft.com/v1.0/me/todo/lists', { headers }).then(r=>r.json());
      if (lists?.value?.length) {
        // pick first list for export target
        const firstListId = lists.value[0].id;
        for (const list of lists.value) {
          const items: MsTodoItems = await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${list.id}/tasks`, { headers }).then(r=>r.json());
          if (items?.value?.length) {
            for (const it of items.value) {
              const title = it.title || 'Untitled';
              const dtStr = it.dueDateTime?.dateTime || null;
              const due_date = dtStr ? dtStr.slice(0,10) : null;
              const timePart = dtStr && dtStr.length >= 16 ? dtStr.slice(11,16) : null; // HH:mm
              const due_time = timePart || null;
              // store composite id listId:taskId to enable updates
              const external_id = `${list.id}:${it.id}`;
              if (!due_date) continue;
              const selectRow = await db.get(`SELECT id FROM tasks WHERE source_id=? AND external_id=?`, [src.id, external_id]) as RowId | undefined;
              if (selectRow?.id) {
                await db.run(`UPDATE tasks SET title=?, due_date=?, due_time=?, bucket_type='day', bucket_date=? WHERE id=?`, [title, due_date, due_time, due_date, selectRow.id]);
                const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [selectRow.id]);
                if (task) broadcast('task_updated', { task });
              } else {
                const info = await db.run(`INSERT INTO tasks (title, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, sort, source_id, external_id)
                  VALUES (?, ?, 'todo', ?, ?, 'day', ?, 'none', 1, 0, ?, ?)`, [title, src.person_id, due_date, due_time, due_date, src.id, external_id]);
                const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [info.lastInsertRowid as number]);
                if (task) broadcast('task_created', { task });
              }
              result.imported++;
            }
          }
        }
        // Export: push local tasks back to Microsoft for this source
        const localTasks = await db.query(`SELECT * FROM tasks WHERE source_id = ?`, [src.id]) as any[];
        for (const t of localTasks) {
          // parse composite id if present
          if (!t.external_id) {
            // create
            const body: any = { title: t.title };
            if (t.due_date) {
              const dt = t.due_time ? `${t.due_date}T${t.due_time}:00` : `${t.due_date}T00:00:00`;
              body.dueDateTime = { dateTime: dt, timeZone: 'UTC' };
            }
            const created = await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${firstListId}/tasks`, {
              method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).then(r=>r.ok?r.json():null).catch(()=>null) as { id?: string } | null;
            if (created?.id) {
              await db.run(`UPDATE tasks SET external_id = ? WHERE id = ?`, [`${firstListId}:${created.id}`, t.id]);
              exported.ms_todo.created++;
            }
          } else {
            // update
            const [listId, taskId] = String(t.external_id).includes(':') ? String(t.external_id).split(':',2) : [null, t.external_id];
            let listToUse = listId;
            // If we don't know list id, fall back to first list
            if (!listToUse) listToUse = firstListId;
            const body: any = { title: t.title };
            if (t.due_date) {
              const dt = t.due_time ? `${t.due_date}T${t.due_time}:00` : `${t.due_date}T00:00:00`;
              body.dueDateTime = { dateTime: dt, timeZone: 'UTC' };
            } else {
              body.dueDateTime = null;
            }
            await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${listToUse}/tasks/${taskId}`, {
              method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).catch(()=>{});
            exported.ms_todo.updated++;
          }
        }
      }
    } else {
      // Calendar events
      const today = new Date();
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth()-1, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth()+2, 0));
      const events: MsEvents = await fetch(`https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}`, { headers }).then(r=>r.json());
      if (events?.value?.length) {
        for (const ev of events.value) {
          const title = ev.subject || 'Event';
          const dtStr = ev.start?.dateTime || null;
          if (!dtStr) continue;
          // For all-day events, store only the date; for timed events, take local HH:mm from the source string.
          const isAllDay = !!(ev as any).isAllDay;
          const due_date = dtStr.slice(0,10);
          const due_time = isAllDay ? null : (dtStr.length >= 16 ? dtStr.slice(11,16) : null);
          const external_id = ev.id;
          const selectRow = await db.get(`SELECT id FROM tasks WHERE source_id=? AND external_id=?`, [src.id, external_id]) as RowId | undefined;
          if (selectRow?.id) {
            await db.run(`UPDATE tasks SET title=?, due_date=?, due_time=?, bucket_type='day', bucket_date=? WHERE id=?`, [title, due_date, due_time, due_date, selectRow.id]);
            const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [selectRow.id]);
            if (task) broadcast('task_updated', { task });
          } else {
            const info = await db.run(`INSERT INTO tasks (title, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, sort, source_id, external_id)
              VALUES (?, ?, 'todo', ?, ?, 'day', ?, 'none', 1, 0, ?, ?)`, [title, src.person_id, due_date, due_time, due_date, src.id, external_id]);
            const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [info.lastInsertRowid as number]);
            if (task) broadcast('task_created', { task });
          }
          result.imported++;
        }
        // Export local tasks to MS calendar: create or update events
        const localTasks = await db.query(`SELECT * FROM tasks WHERE source_id = ?`, [src.id]) as any[];
        for (const t of localTasks) {
          const body: any = { subject: t.title };
          if (t.due_date) {
            const dt = t.due_time ? `${t.due_date}T${t.due_time}:00` : `${t.due_date}T00:00:00`;
            body.start = { dateTime: dt, timeZone: 'UTC' };
            body.end = { dateTime: dt, timeZone: 'UTC' };
          }
          if (!t.external_id) {
            const created = await fetch(`https://graph.microsoft.com/v1.0/me/events`, {
              method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).then(r=>r.ok?r.json():null).catch(()=>null) as { id?: string } | null;
            if (created?.id) {
              await db.run(`UPDATE tasks SET external_id=? WHERE id=?`, [created.id, t.id]);
              exported.ms_calendar.created++;
            }
          } else {
            await fetch(`https://graph.microsoft.com/v1.0/me/events/${t.external_id}`, {
              method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).catch(()=>{});
            exported.ms_calendar.updated++;
          }
        }
      }
    }
  } else if (src.provider === 'google_tasks' || src.provider === 'google_calendar') {
    if (!src.access_token) return new Response('Not authorized', { status: 401 });
    const headers: HeadersInit = { Authorization: `Bearer ${src.access_token}` };
    if (src.provider === 'google_tasks') {
      const lists: GTaskLists = await fetch('https://www.googleapis.com/tasks/v1/users/@me/lists', { headers }).then(r=>r.json());
      if (lists?.items?.length) {
        const firstListId = lists.items[0].id as string;
        for (const list of lists.items) {
          const tasks: GTasks = await fetch(`https://www.googleapis.com/tasks/v1/lists/${list.id}/tasks`, { headers }).then(r=>r.json());
          if (tasks?.items?.length) {
            for (const it of tasks.items) {
              const title = it.title || 'Untitled';
              const due = it.due || null; // RFC3339 date or datetime
              const due_date = due ? due.slice(0,10) : null;
              const due_time = due && due.length >= 16 ? due.slice(11,16) : null;
              const external_id = `${list.id}:${it.id}`;
              if (!due_date) continue;
              const selectRow = await db.get(`SELECT id FROM tasks WHERE source_id=? AND external_id=?`, [src.id, external_id]) as RowId | undefined;
              if (selectRow?.id) {
                await db.run(`UPDATE tasks SET title=?, due_date=?, due_time=?, bucket_type='day', bucket_date=? WHERE id=?`, [title, due_date, due_time, due_date, selectRow.id]);
              } else {
                await db.run(`INSERT INTO tasks (title, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, sort, source_id, external_id)
                  VALUES (?, ?, 'todo', ?, ?, 'day', ?, 'none', 1, 0, ?, ?)`, [title, src.person_id, due_date, due_time, due_date, src.id, external_id]);
              }
              result.imported++;
            }
          }
        }
        // Export local tasks to Google Tasks
        // Include tasks already bound to this source as well as unbound tasks for this person
        const localTasks = await db.query(`SELECT * FROM tasks WHERE (source_id = ? OR (source_id IS NULL AND person_id = ?))`, [src.id, src.person_id]) as any[];
        for (const t of localTasks) {
          if (!t.external_id) {
            const body: any = { title: t.title };
            const today = new Date().toISOString().slice(0,10);
            const dueDate = t.due_date || today;
            body.due = t.due_time ? `${dueDate}T${t.due_time}:00.000Z` : `${dueDate}T00:00:00.000Z`;
            const created = await fetch(`https://www.googleapis.com/tasks/v1/lists/${firstListId}/tasks`, {
              method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).then(r=>r.ok?r.json():null).catch(()=>null) as { id?: string } | null;
            if (created?.id) {
              await db.run(`UPDATE tasks SET source_id = COALESCE(source_id, ?), external_id = ? WHERE id = ?`, [src.id, `${firstListId}:${created.id}`, t.id]);
              const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [t.id]);
              if (task) broadcast('task_updated', { task });
              exported.google_tasks.created++;
            }
          } else {
            const [listId, taskId] = String(t.external_id).includes(':') ? String(t.external_id).split(':',2) : [firstListId, t.external_id];
            const body: any = { title: t.title };
            const today = new Date().toISOString().slice(0,10);
            const dueDate = t.due_date || today;
            body.due = t.due_time ? `${dueDate}T${t.due_time}:00.000Z` : `${dueDate}T00:00:00.000Z`;
            await fetch(`https://www.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
              method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            }).catch(()=>{});
            if (t.source_id == null) await db.run(`UPDATE tasks SET source_id = ? WHERE id = ?`, [src.id, t.id]);
            exported.google_tasks.updated++;
          }
        }
      }
    } else {
      // Google Calendar
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()+2, 0));
      const events: GEvents = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}`,
        { headers }
      ).then(r=>r.json());
      if (events?.items?.length) {
        for (const ev of events.items) {
          const title = ev.summary || 'Event';
          const dt = ev.start?.dateTime || ev.start?.date || null;
          if (!dt) continue;
          const due_date = dt.slice(0,10);
          const due_time = dt.length >= 16 && dt.includes('T') ? dt.slice(11,16) : null;
          const external_id = ev.id as string;
          const selectRow = await db.get(`SELECT id FROM tasks WHERE source_id=? AND external_id=?`, [src.id, external_id]) as RowId | undefined;
          if (selectRow?.id) {
            await db.run(`UPDATE tasks SET title=?, due_date=?, due_time=?, bucket_type='day', bucket_date=? WHERE id=?`, [title, due_date, due_time, due_date, selectRow.id]);
          } else {
            await db.run(`INSERT INTO tasks (title, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, sort, source_id, external_id)
              VALUES (?, ?, 'todo', ?, ?, 'day', ?, 'none', 1, 0, ?, ?)`, [title, src.person_id, due_date, due_time, due_date, src.id, external_id]);
          }
          result.imported++;
        }
      }
      // Export local tasks to Google Calendar primary
      // Include tasks already bound to this source as well as unbound tasks for this person
      const localTasks = await db.query(`SELECT * FROM tasks WHERE (source_id = ? OR (source_id IS NULL AND person_id = ?))`, [src.id, src.person_id]) as any[];
      for (const t of localTasks) {
        const body: any = { summary: t.title };
        const today = new Date().toISOString().slice(0,10);
        const dueDate = t.due_date || today;
        if (t.due_time) {
          const dt = `${dueDate}T${t.due_time}:00Z`;
          body.start = { dateTime: dt };
          body.end = { dateTime: dt };
        } else {
          body.start = { date: dueDate };
          body.end = { date: dueDate };
        }
        if (!t.external_id) {
          const created = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          }).then(r=>r.ok?r.json():null).catch(()=>null) as { id?: string } | null;
          if (created?.id) {
            await db.run(`UPDATE tasks SET source_id = COALESCE(source_id, ?), external_id=? WHERE id=?`, [src.id, created.id, t.id]);
            const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [t.id]);
            if (task) broadcast('task_updated', { task });
            exported.google_calendar.created++;
          }
        } else {
          await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${t.external_id}`, {
            method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          }).catch(()=>{});
          if (t.source_id == null) await db.run(`UPDATE tasks SET source_id = ? WHERE id = ?`, [src.id, t.id]);
          exported.google_calendar.updated++;
        }
      }
    }
  } else if (src.url) {
    result = await importICS(src.url, src.person_id, src.id);
  } else {
    return new Response('No handler for provider', { status: 400 });
  }
  return Response.json({ ok: true, result: { imported: result.imported, exported } }, { headers: corsHeaders() });
}

export async function OPTIONS() {
  return preflight();
}
