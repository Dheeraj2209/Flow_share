import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BodyIn = {
  personId?: number | string;
  secret?: string;
  reminderId?: string | null;
  title?: string;
  due_date?: string | null; // YYYY-MM-DD
  due_time?: string | null; // HH:mm
  completed?: boolean;
  deleted?: boolean;
  listName?: string | null;
};

export async function POST(req: NextRequest) {
  const db = getDb();
  let body: BodyIn = {};
  try { body = await req.json(); } catch {}
  const personId = body.personId != null ? Number(body.personId) : null;
  if (!personId) return new Response('personId required', { status: 400, headers: corsHeaders() });
  const incomingSecret = body.secret || null;
  const reminderId = body.reminderId || null;
  const deleted = !!body.deleted;

  // Ensure or create a source row for this person/provider
  let src = await db.get(`SELECT * FROM external_sources WHERE person_id = ? AND provider = 'apple_reminders_webhook'`, [personId]) as any | undefined;
  if (!src) {
    const info = await db.run(`INSERT INTO external_sources (person_id, provider, account) VALUES (?, 'apple_reminders_webhook', ?)`, [personId, incomingSecret]);
    src = await db.get(`SELECT * FROM external_sources WHERE id = ?`, [info.lastInsertRowid]) as any;
  } else {
    if (src.account && incomingSecret && src.account !== incomingSecret) {
      return new Response('Unauthorized (secret mismatch)', { status: 401, headers: corsHeaders() });
    }
    // If no secret stored yet and one is provided now, persist it.
    if (!src.account && incomingSecret) {
      await db.run(`UPDATE external_sources SET account = ? WHERE id = ?`, [incomingSecret, src.id]);
      src.account = incomingSecret;
    }
  }

  if (!reminderId) return new Response('reminderId required', { status: 400, headers: corsHeaders() });

  if (deleted) {
    const row = await db.get(`SELECT id FROM tasks WHERE source_id = ? AND external_id = ?`, [src.id, reminderId]) as any | undefined;
    if (row?.id) await db.run(`DELETE FROM tasks WHERE id = ?`, [row.id]);
    return Response.json({ ok: true, action: 'deleted', task_id: row?.id || null }, { headers: corsHeaders() });
  }

  const title = (body.title || 'Untitled').trim();
  const due_date = body.due_date || null;
  const due_time = body.due_time || null;
  const completed = !!body.completed;

  const existing = await db.get(`SELECT * FROM tasks WHERE source_id = ? AND external_id = ?`, [src.id, reminderId]) as any | undefined;
  if (existing?.id) {
    await db.run(`UPDATE tasks SET title=?, due_date=?, due_time=?, status=? WHERE id = ?`, [title, due_date, due_time, completed ? 'done' : 'todo', existing.id]);
    const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [existing.id]);
    return Response.json({ ok: true, action: 'updated', task }, { headers: corsHeaders() });
  } else {
    const info = await db.run(
      `INSERT INTO tasks (title, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, sort, color, priority, source_id, external_id)
       VALUES (?, ?, ?, ?, ?, 'day', ?, 'none', 1, 0, NULL, 0, ?, ?)`,
      [title, personId, completed ? 'done' : 'todo', due_date, due_time, due_date, src.id, reminderId]
    );
    const task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [info.lastInsertRowid as number]);
    return Response.json({ ok: true, action: 'created', task }, { headers: corsHeaders() });
  }
}

export async function OPTIONS() { return preflight(); }

