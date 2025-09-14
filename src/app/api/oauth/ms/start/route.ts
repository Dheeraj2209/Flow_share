import { NextRequest } from 'next/server';
import { getPublicOrigin } from '@/lib/urls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get('personId') || '';
  const provider = searchParams.get('provider') || 'ms_graph_todo';
  const clientId = process.env.MS_CLIENT_ID;
  const tenant = process.env.MS_TENANT_ID || 'common';
  if (!clientId) return new Response('MS_CLIENT_ID missing', { status: 500 });
  const origin = getPublicOrigin(req);
  const redirectUri = `${origin}/api/oauth/ms/callback`;
  const scopes = provider === 'ms_graph_calendar'
    ? 'offline_access Calendars.ReadWrite'
    : 'offline_access Tasks.ReadWrite';
  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', JSON.stringify({ personId, provider }));
  return Response.redirect(url.toString(), 302);
}
