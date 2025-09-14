import { NextRequest } from 'next/server';

function stripTrailingSlash(s: string) {
  return s.replace(/\/+$/, '');
}

// Determine the public origin for absolute URLs behind proxies (Render/Cloudflare).
// Priority:
// 1) PUBLIC_ORIGIN env (or PUBLIC_URL) if provided
// 2) X-Forwarded-Proto + X-Forwarded-Host headers
// 3) Host header + default https
// 4) req URL origin as a last resort
export function getPublicOrigin(req: NextRequest): string {
  const envOrigin = process.env.PUBLIC_ORIGIN || process.env.PUBLIC_URL || '';
  if (envOrigin) return stripTrailingSlash(envOrigin);

  const xfProto = req.headers.get('x-forwarded-proto');
  const xfHost = req.headers.get('x-forwarded-host');
  if (xfProto && xfHost) return `${xfProto}://${stripTrailingSlash(xfHost)}`;

  const host = req.headers.get('host');
  if (host) return `https://${stripTrailingSlash(host)}`;

  try {
    const u = new URL(req.url);
    return stripTrailingSlash(u.origin);
  } catch {
    return 'https://localhost';
  }
}

