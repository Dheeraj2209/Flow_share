import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get('personId');
  const rows = personId
    ? await db.query(`SELECT * FROM external_sources WHERE person_id = ? ORDER BY created_at DESC`, [Number(personId)])
    : await db.query(`SELECT * FROM external_sources ORDER BY created_at DESC`);
  return Response.json({ sources: rows }, { headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => ({} as any));
  const person_id = Number(body.person_id);
  const provider = String(body.provider || '').trim();
  const url = body.url ? String(body.url) : null;
  if (!person_id || !provider) return new Response('person_id and provider required', { status: 400, headers: corsHeaders() });
  const info = await db.run(`INSERT INTO external_sources (person_id, provider, url) VALUES (?, ?, ?)`, [person_id, provider, url]);
  const source = await db.get(`SELECT * FROM external_sources WHERE id = ?`, [info.lastInsertRowid as number]);
  return Response.json({ source }, { status: 201, headers: corsHeaders() });
}

export async function OPTIONS() {
  return preflight();
}
