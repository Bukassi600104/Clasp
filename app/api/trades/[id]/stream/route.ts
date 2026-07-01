import { NextRequest } from 'next/server';
import { getTrade } from '@/lib/store';
import { backendName } from '@/lib/db/repo';
import { db } from '@/lib/firebase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Live trade updates over Server-Sent Events. The tracking screens hold one
 * EventSource instead of polling; each message is a version marker
 * (`updated_at`) and the client refetches the full detail through the normal
 * authorized API when it changes.
 *
 * Transport per backend:
 *  - Firestore: a real document listener (onSnapshot) pushes changes.
 *  - Memory (local dev): a short server-side interval diffs `updated_at`.
 * The stream ends itself before the function limit; EventSource reconnects
 * transparently, so the client experience is a continuous subscription.
 *
 * Trade ids are unguessable capabilities (the share link), and the payload
 * carries only state + timestamp, so this leaks nothing the checkout page
 * would not already show.
 */
export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const tradeId = ctx.params.id;
  const initial = await getTrade(tradeId);
  if (!initial) return new Response('not found', { status: 404 });

  const encoder = new TextEncoder();
  const CLOSE_AFTER_MS = 55_000;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let lastSent = '';
      const send = (state: string, updatedAt: string) => {
        if (closed) return;
        const marker = `${state}:${updatedAt}`;
        if (marker === lastSent) return;
        lastSent = marker;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ state, updated_at: updatedAt })}\n\n`));
      };
      const cleanups: Array<() => void> = [];
      const close = () => {
        if (closed) return;
        closed = true;
        for (const fn of cleanups) fn();
        try { controller.close(); } catch { /* already closed */ }
      };

      send(initial.state, initial.updated_at);

      if (backendName() === 'firestore') {
        const unsubscribe = db().collection('trades').doc(tradeId).onSnapshot(
          (snap) => {
            const t = snap.data() as { state?: string; updated_at?: string } | undefined;
            if (t?.state && t.updated_at) send(t.state, t.updated_at);
          },
          () => close()
        );
        cleanups.push(unsubscribe);
      } else {
        const timer = setInterval(async () => {
          try {
            const t = await getTrade(tradeId);
            if (t) send(t.state, t.updated_at);
          } catch { close(); }
        }, 2_500);
        cleanups.push(() => clearInterval(timer));
      }

      // Heartbeat keeps proxies from buffering the stream shut.
      const beat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': ping\n\n'));
      }, 15_000);
      cleanups.push(() => clearInterval(beat));

      const stop = setTimeout(close, CLOSE_AFTER_MS);
      cleanups.push(() => clearTimeout(stop));
      req.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
