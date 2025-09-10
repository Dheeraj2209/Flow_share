import { NextRequest } from 'next/server';
import { addSubscriber, removeSubscriber } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') || Math.random().toString(36).slice(2);

  const ts = new TransformStream();
  const writer = ts.writable.getWriter();

  const encoder = new TextEncoder();
  const write = (chunk: string) => writer.write(encoder.encode(chunk));
  const close = () => writer.close();

  addSubscriber({ id, write, close });

  req.signal.addEventListener('abort', () => {
    removeSubscriber(id);
  });

  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Allow CORS for same-origin clients and multi-tab
    'Access-Control-Allow-Origin': '*',
  });

  return new Response(ts.readable, { headers, status: 200 });
}

