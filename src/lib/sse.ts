type Subscriber = {
  id: string;
  write: (chunk: string) => void;
  close: () => void;
};

const subscribers = new Map<string, Subscriber>();

function sseFormat(event: string, data: unknown) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\n` + `data: ${payload}\n\n`;
}

export function addSubscriber(sub: Subscriber) {
  subscribers.set(sub.id, sub);
  // Send a hello event
  try {
    sub.write(sseFormat('hello', { ok: true }));
  } catch {}
}

export function removeSubscriber(id: string) {
  const sub = subscribers.get(id);
  if (sub) {
    try { sub.close(); } catch {}
    subscribers.delete(id);
  }
}

export function broadcast(event: string, data: unknown) {
  const msg = sseFormat(event, data);
  for (const [, sub] of subscribers) {
    try {
      sub.write(msg);
    } catch {
      try { sub.close(); } catch {}
    }
  }
}

// Keep-alive pings
setInterval(() => {
  const msg = sseFormat('ping', Date.now());
  for (const [, sub] of subscribers) {
    try { sub.write(msg); } catch {}
  }
}, 25000);
