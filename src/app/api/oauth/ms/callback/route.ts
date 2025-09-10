import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const stateRaw = searchParams.get('state');
  if (!code || !stateRaw) return new Response('Missing code/state', { status: 400 });
  const state = JSON.parse(stateRaw);
  const personId = Number(state.personId);
  const provider = String(state.provider || 'ms_graph_todo');
  const clientId = process.env.MS_CLIENT_ID!;
  const clientSecret = process.env.MS_CLIENT_SECRET!;
  const tenant = process.env.MS_TENANT_ID || 'common';
  const redirectUri = `${origin}/api/oauth/ms/callback`;
  const tokenEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const resp = await fetch(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!resp.ok) {
    const text = await resp.text();
    return new Response(`Token exchange failed: ${text}`, { status: 500 });
  }
  const tok = await resp.json();
  const access_token = tok.access_token as string;
  const refresh_token = tok.refresh_token as string | undefined;
  const expires_in = Number(tok.expires_in || 3600);
  const expires_at = Math.floor(Date.now() / 1000) + expires_in - 60;

  const db = getDb();
  await db.run(`INSERT INTO external_sources (person_id, provider, access_token, refresh_token, expires_at, scope, account)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [personId, provider, access_token, refresh_token || null, expires_at, tok.scope || null, null]);
  return new Response('<script>window.close && window.close();</script> Connected. You can close this window.', { headers: { 'Content-Type': 'text/html' } });
}
