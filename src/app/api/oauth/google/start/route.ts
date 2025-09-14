import { NextRequest } from 'next/server';
import { getPublicOrigin } from '@/lib/urls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const personId = searchParams.get('personId') || '';
  const provider = searchParams.get('provider') || 'google_tasks';
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return new Response('GOOGLE_CLIENT_ID missing', { status: 500 });
  const origin = getPublicOrigin(req);
  const redirectUri = `${origin}/api/oauth/google/callback`;
  const scopes = provider === 'google_calendar'
    ? [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ]
    : [
        'https://www.googleapis.com/auth/tasks',
      ];
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', JSON.stringify({ personId, provider }));
  return Response.redirect(url.toString(), 302);
}
