import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(Number(params.id));
  if (!task) return new Response('Not found', { status: 404 });
  return Response.json({ task });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const id = Number(params.id);
  const existing = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!existing) return new Response('Not found', { status: 404 });
  const body = await req.json().catch(() => ({} as any));
  const fields: string[] = [];
  const values: any[] = [];
  const updatable = ['title','description','person_id','status','due_date','due_time','bucket_type','bucket_date','recurrence','interval','byweekday','until','sort','color','priority'] as const;
  for (const key of updatable) {
    if (key in body) {
      if (key === 'interval') {
        fields.push(`${key} = ?`); values.push(Math.max(1, Number(body[key])));
      } else if (key === 'byweekday') {
        fields.push(`${key} = ?`); values.push(body[key] ? JSON.stringify(body[key]) : null);
      } else if (key === 'person_id') {
        fields.push(`${key} = ?`); values.push(body[key] != null ? Number(body[key]) : null);
      } else if (key === 'sort') {
        fields.push(`${key} = ?`); values.push(Number(body[key])|0);
      } else if (key === 'priority') {
        fields.push(`${key} = ?`); values.push(Math.max(0, Math.min(3, Number(body[key]))));
      } else {
        fields.push(`${key} = ?`); values.push(body[key] ?? null);
      }
    }
  }
  if (!fields.length) return new Response('No changes', { status: 400 });
  const sql = `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`;
  values.push(id);
  db.prepare(sql).run(...values);
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  broadcast('task_updated', { task });
  return Response.json({ task });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const id = Number(params.id);
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!task) return new Response('Not found', { status: 404 });
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  broadcast('task_deleted', { id });
  return new Response(null, { status: 204 });
}
