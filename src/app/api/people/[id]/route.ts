import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/sse';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const person = db.prepare(`SELECT * FROM people WHERE id = ?`).get(Number(params.id));
  if (!person) return new Response('Not found', { status: 404, headers: corsHeaders() });
  return Response.json({ person }, { headers: corsHeaders() });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const name = body.name !== undefined ? String(body.name).trim() : undefined;
  const email = body.email !== undefined ? (body.email ? String(body.email).trim() : null) : undefined;
  const color = body.color !== undefined ? (body.color ? String(body.color) : null) : undefined;
  const id = Number(params.id);
  const existing = db.prepare(`SELECT * FROM people WHERE id = ?`).get(id);
  if (!existing) return new Response('Not found', { status: 404, headers: corsHeaders() });
  const newName = name !== undefined ? name : existing.name;
  const newEmail = email !== undefined ? email : existing.email;
  const newColor = color !== undefined ? color : existing.color;
  db.prepare(`UPDATE people SET name = ?, email = ?, color = ? WHERE id = ?`).run(newName, newEmail, newColor, id);
  const person = db.prepare(`SELECT * FROM people WHERE id = ?`).get(id);
  broadcast('people_updated', { type: 'updated', person });
  return Response.json({ person }, { headers: corsHeaders() });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const id = Number(params.id);
  const person = db.prepare(`SELECT * FROM people WHERE id = ?`).get(id);
  if (!person) return new Response('Not found', { status: 404, headers: corsHeaders() });
  // On delete, set tasks.person_id = NULL
  db.prepare(`UPDATE tasks SET person_id = NULL WHERE person_id = ?`).run(id);
  db.prepare(`DELETE FROM people WHERE id = ?`).run(id);
  broadcast('people_updated', { type: 'deleted', id });
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function OPTIONS() {
  return preflight();
}
