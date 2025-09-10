import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/sse';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const people = await db.query(`SELECT * FROM people ORDER BY name COLLATE NOCASE`);
  return Response.json({ people }, { headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const email = body.email ? String(body.email).trim() : null;
  let color = body.color ? String(body.color) : null;
  if (!name) return new Response('Name required', { status: 400, headers: corsHeaders() });
  if (!color) {
    const palette = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];
    color = palette[Math.floor(Math.random() * palette.length)];
  }
  const info = await db.run(`INSERT INTO people (name, email, color) VALUES (?, ?, ?)`, [name, email, color]);
  const person = await db.get(`SELECT * FROM people WHERE id = ?`, [info.lastInsertRowid as number]);
  broadcast('people_updated', { type: 'created', person });
  return Response.json({ person }, { status: 201, headers: corsHeaders() });
}

export async function OPTIONS() {
  return preflight();
}
