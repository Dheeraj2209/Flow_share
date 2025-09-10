import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const src = await db.get(`SELECT * FROM external_sources WHERE id = ?`, [Number(params.id)]);
  if (!src) return new Response('Not found', { status: 404, headers: corsHeaders() });
  return Response.json({ source: src }, { headers: corsHeaders() });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const id = Number(params.id);
  const body = await req.json().catch(()=>({} as any));
  const url = body.url !== undefined ? (body.url ? String(body.url) : null) : undefined;
  const provider = body.provider !== undefined ? String(body.provider) : undefined;
  const fields: string[] = [];
  const vals: any[] = [];
  if (url !== undefined) { fields.push('url = ?'); vals.push(url); }
  if (provider !== undefined) { fields.push('provider = ?'); vals.push(provider); }
  if (!fields.length) return new Response('No changes', { status: 400 });
  vals.push(id);
  await db.run(`UPDATE external_sources SET ${fields.join(', ')} WHERE id = ?`, vals);
  const src = await db.get(`SELECT * FROM external_sources WHERE id = ?`, [id]);
  return Response.json({ source: src }, { headers: corsHeaders() });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const id = Number(params.id);
  await db.run(`DELETE FROM external_sources WHERE id = ?`, [id]);
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function OPTIONS() {
  return preflight();
}
