import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/sse';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get('personId');
  const where: string[] = [];
  const params: any[] = [];
  if (personId) { where.push('person_id = ?'); params.push(Number(personId)); }
  const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  const tasks = db.prepare(sql).all(...params);
  return Response.json({ tasks }, { headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => ({} as any));
  const title = String(body.title || '').trim();
  if (!title) return new Response('Title required', { status: 400 });
  const description = body.description ? String(body.description) : null;
  const person_id = body.person_id != null ? Number(body.person_id) : null;
  const status = body.status && ['todo','in_progress','done'].includes(body.status) ? body.status : 'todo';
  const due_date = body.due_date ? String(body.due_date) : null;
  const due_time = body.due_time ? String(body.due_time) : null;
  const bucket_type = body.bucket_type ?? null; // 'day' | 'week' | 'month'
  const bucket_date = body.bucket_date ?? null; // ISO
  const recurrence = body.recurrence && ['none','daily','weekly','monthly'].includes(body.recurrence) ? body.recurrence : 'none';
  const interval = body.interval != null ? Math.max(1, Number(body.interval)) : 1;
  const byweekday = body.byweekday ? JSON.stringify(body.byweekday) : null;
  const until = body.until ? String(body.until) : null;
  const color = body.color ? String(body.color) : null;
  const priority = body.priority != null ? Math.max(0, Math.min(3, Number(body.priority))) : 0;
  // sort ordering for day buckets
  let sort = 0;
  if (bucket_type === 'day' && bucket_date) {
    const row = db.prepare(`SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM tasks WHERE bucket_type='day' AND bucket_date=?`).get(bucket_date) as any;
    sort = row?.next ?? 0;
  }

  const stmt = db.prepare(`
    INSERT INTO tasks (title, description, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, byweekday, until, sort, color, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(title, description, person_id, status, due_date, due_time, bucket_type, bucket_date, recurrence, interval, byweekday, until, sort, color, priority);
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(info.lastInsertRowid as number);
  broadcast('task_created', { task });
  return Response.json({ task }, { status: 201, headers: corsHeaders() });
}

export async function OPTIONS() {
  return preflight();
}
