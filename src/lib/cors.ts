export function getCorsOrigin() {
  const origin = process.env.CORS_ORIGIN || '*';
  return origin;
}

export function corsHeaders(extra?: HeadersInit): HeadersInit {
  const origin = getCorsOrigin();
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
