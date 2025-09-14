import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/sse';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const person = await db.get(`SELECT * FROM people WHERE id = ?`, [Number(params.id)]);
  if (!person) return new Response('Not found', { status: 404, headers: corsHeaders() });
  return Response.json({ person }, { headers: corsHeaders() });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const name = body.name !== undefined ? String(body.name).trim() : undefined;
  const email = body.email !== undefined ? (body.email ? String(body.email).trim() : null) : undefined;
  const color = body.color !== undefined ? (body.color ? String(body.color) : null) : undefined;
  const default_source_id = body.default_source_id !== undefined ? (body.default_source_id != null ? Number(body.default_source_id) : null) : undefined;
  const id = Number(params.id);
  const existing = await db.get(`SELECT * FROM people WHERE id = ?`, [id]);
  if (!existing) return new Response('Not found', { status: 404, headers: corsHeaders() });
  const newName = name !== undefined ? name : existing.name;
  const newEmail = email !== undefined ? email : existing.email;
  const newColor = color !== undefined ? color : existing.color;
  const newDefault = default_source_id !== undefined ? default_source_id : (existing as any).default_source_id ?? null;
  await db.run(`UPDATE people SET name = ?, email = ?, color = ?, default_source_id = ? WHERE id = ?`, [newName, newEmail, newColor, newDefault, id]);
  const person = await db.get(`SELECT * FROM people WHERE id = ?`, [id]);
  broadcast('people_updated', { type: 'updated', person });
  return Response.json({ person }, { headers: corsHeaders() });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const id = Number(params.id);
  const person = await db.get(`SELECT * FROM people WHERE id = ?`, [id]);
  if (!person) return new Response('Not found', { status: 404, headers: corsHeaders() });
  // On delete, set tasks.person_id = NULL
  await db.run(`UPDATE tasks SET person_id = NULL WHERE person_id = ?`, [id]);
  await db.run(`DELETE FROM people WHERE id = ?`, [id]);
  broadcast('people_updated', { type: 'deleted', id });
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function OPTIONS() {
  return preflight();
}
