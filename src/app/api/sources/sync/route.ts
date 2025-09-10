import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import ical from 'node-ical';
import { ExternalSource } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function importICS(url: string, person_id: number, source_id: number) {
  const db = getDb();
  const data = await ical.async.fromURL(url);
  const tasks: any[] = [];
  for (const k in data) {
    const ev: any = (data as any)[k];
    if (ev.type !== 'VEVENT') continue;
    const title = String(ev.summary || 'Untitled').trim();
    const d = ev.start as Date | undefined;
    if (!d) continue;
    const due_date = d.toISOString().slice(0,10);
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const due_time = `${hh}:${mm}`;
    const external_id = String(ev.uid || k);
    tasks.push({ title, due_date, due_time, external_id });
  }
  const insert = db.prepare(`INSERT INTO tasks (title, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, sort, source_id, external_id)
    VALUES (?, ?, 'todo', ?, ?, 'day', ?, 'none', 1, 0, ?, ?)`);
  const select = db.prepare(`SELECT id FROM tasks WHERE source_id = ? AND external_id = ?`);
  const update = db.prepare(`UPDATE tasks SET title=?, due_date=?, due_time=?, bucket_type='day', bucket_date=? WHERE id = ?`);
  for (const t of tasks) {
    const existing = select.get(source_id, t.external_id) as any;
    if (existing?.id) {
      update.run(t.title, t.due_date, t.due_time, t.due_date, existing.id);
    } else {
      insert.run(t.title, person_id, t.due_date, t.due_time, t.due_date, source_id, t.external_id);
    }
  }
  return { imported: tasks.length };
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(()=>({} as any));
  const source_id = body.source_id ? Number(body.source_id) : null;
  if (!source_id) return new Response('source_id required', { status: 400 });
  const src = db.prepare(`SELECT * FROM external_sources WHERE id = ?`).get(source_id) as ExternalSource & any;
  if (!src) return new Response('Source not found', { status: 404 });
  let result: any = { imported: 0 };
  if (src.provider === 'ms_graph_todo' || src.provider === 'ms_graph_calendar') {
    // Basic sync using stored access token; production should refresh when expired
    if (!src.access_token) return new Response('Not authorized', { status: 401 });
    const headers = { Authorization: `Bearer ${src.access_token}` } as any;
    if (src.provider === 'ms_graph_todo') {
      const lists = await fetch('https://graph.microsoft.com/v1.0/me/todo/lists', { headers }).then(r=>r.json());
      if (lists?.value?.length) {
        for (const list of lists.value) {
          const items = await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${list.id}/tasks`, { headers }).then(r=>r.json());
          if (items?.value?.length) {
            for (const it of items.value) {
              const title = it.title || 'Untitled';
              const d = it.dueDateTime?.dateTime ? new Date(it.dueDateTime.dateTime) : null;
              const due_date = d ? d.toISOString().slice(0,10) : null;
              const due_time = d ? `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : null;
              const external_id = it.id;
              if (!due_date) continue;
              const select = db.prepare(`SELECT id FROM tasks WHERE source_id=? AND external_id=?`).get(src.id, external_id) as any;
              if (select?.id) {
                db.prepare(`UPDATE tasks SET title=?, due_date=?, due_time=?, bucket_type='day', bucket_date=? WHERE id=?`).run(title, due_date, due_time, due_date, select.id);
              } else {
                db.prepare(`INSERT INTO tasks (title, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, sort, source_id, external_id)
                  VALUES (?, ?, 'todo', ?, ?, 'day', ?, 'none', 1, 0, ?, ?)`)
                  .run(title, src.person_id, due_date, due_time, due_date, src.id, external_id);
              }
              result.imported++;
            }
          }
        }
      }
    } else {
      // Calendar events
      const today = new Date();
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth()-1, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth()+2, 0));
      const events = await fetch(`https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}`, { headers }).then(r=>r.json());
      if (events?.value?.length) {
        for (const ev of events.value) {
          const title = ev.subject || 'Event';
          const d = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
          if (!d) continue;
          const due_date = d.toISOString().slice(0,10);
          const due_time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          const external_id = ev.id;
          const select = db.prepare(`SELECT id FROM tasks WHERE source_id=? AND external_id=?`).get(src.id, external_id) as any;
          if (select?.id) {
            db.prepare(`UPDATE tasks SET title=?, due_date=?, due_time=?, bucket_type='day', bucket_date=? WHERE id=?`).run(title, due_date, due_time, due_date, select.id);
          } else {
            db.prepare(`INSERT INTO tasks (title, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, sort, source_id, external_id)
              VALUES (?, ?, 'todo', ?, ?, 'day', ?, 'none', 1, 0, ?, ?)`)
              .run(title, src.person_id, due_date, due_time, due_date, src.id, external_id);
          }
          result.imported++;
        }
      }
    }
  } else if (src.url) {
    result = await importICS(src.url, src.person_id, src.id);
  } else {
    return new Response('No handler for provider', { status: 400 });
  }
  return Response.json({ ok: true, result });
}
