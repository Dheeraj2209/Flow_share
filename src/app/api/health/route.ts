import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { corsHeaders, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const db = getDb();
  try {
    const row = await db.get('SELECT 1 AS ok');
    const countRow = await db.get('SELECT COUNT(*) AS tasks FROM tasks');
    return Response.json({
      ok: true,
      db: row?.ok === 1 || row?.ok === '1' ? 'up' : 'unknown',
      tasks: Number((countRow as any)?.tasks || 0),
      time: new Date().toISOString(),
    }, { headers: corsHeaders() });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500, headers: corsHeaders() });
  }
}

export async function OPTIONS() {
  return preflight();
}

