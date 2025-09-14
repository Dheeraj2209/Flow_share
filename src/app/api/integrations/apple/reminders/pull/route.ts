import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get('personId');
  const since = searchParams.get('since'); // ISO string
  if (!personId) return new Response('personId required', { status: 400, headers: corsHeaders() });
  // Ensure a source exists for this person
  let src = await db.get(`SELECT * FROM external_sources WHERE person_id = ? AND provider = 'apple_reminders_webhook'`, [Number(personId)]) as any | undefined;
  if (!src) {
    const info = await db.run(`INSERT INTO external_sources (person_id, provider) VALUES (?, 'apple_reminders_webhook')`, [Number(personId)]);
    src = await db.get(`SELECT * FROM external_sources WHERE id = ?`, [info.lastInsertRowid]) as any;
  }

  let rows: any[] = [];
  if (since) {
    rows = await db.query(
      `SELECT id, title, person_id, status, due_date, due_time, external_id, updated_at
       FROM tasks
       WHERE person_id = ?
         AND updated_at >= ?
         AND (source_id IS NULL OR source_id = ?)
       ORDER BY updated_at ASC`,
      [Number(personId), since, src.id]
    ) as any[];
  } else {
    rows = await db.query(
      `SELECT id, title, person_id, status, due_date, due_time, external_id, updated_at
       FROM tasks
       WHERE person_id = ?
         AND (source_id IS NULL OR source_id = ?)
       ORDER BY updated_at DESC
       LIMIT 100`,
      [Number(personId), src.id]
    ) as any[];
  }
  return Response.json({ source_id: src.id, tasks: rows }, { headers: corsHeaders() });
}

export async function OPTIONS() { return preflight(); }

