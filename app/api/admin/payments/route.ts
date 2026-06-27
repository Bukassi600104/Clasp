import { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import {
  getIncompleteServerPayments, completePayment, cancelPayment,
} from '@/lib/pi-server';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

// SECURITY (A07): compare secrets in constant time. Hashing to a fixed length
// first lets us compare without leaking length and satisfies timingSafeEqual's
// equal-length requirement — defeats timing side-channels on ADMIN_SECRET.
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Admin diagnostic + repair for stuck Pi payments (ADMIN_SECRET-guarded).
 *
 *  GET  → list this app's incomplete server payments (signed but not completed).
 *  POST → resolve them: complete (if a txid exists) or cancel (if not), so a
 *         leftover payment stops blocking the user's next "createPayment".
 *         Body: { id?: string } to target one, or empty to sweep all.
 */
function authed(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false; // fail-closed: no secret configured → deny
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return token.length > 0 && secretsMatch(token, secret);
}

export const GET = handler(async (req: NextRequest) => {
  if (!authed(req)) return fail('Unauthorized.', 401);
  if (!process.env.PI_API_KEY) return fail('PI_API_KEY not configured.', 503);
  const list = await getIncompleteServerPayments();
  return ok({
    count: list.length,
    payments: list.map((p) => ({
      identifier: p.identifier,
      amount: p.amount,
      memo: p.memo,
      metadata: p.metadata,
      status: p.status,
      txid: p.transaction?.txid ?? null,
    })),
  });
});

export const POST = handler(async (req: NextRequest) => {
  if (!authed(req)) return fail('Unauthorized.', 401);
  if (!process.env.PI_API_KEY) return fail('PI_API_KEY not configured.', 503);
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const list = await getIncompleteServerPayments();
  const targets = body.id ? list.filter((p) => p.identifier === body.id) : list;

  const results: Array<{ id: string; action: string; error?: string }> = [];
  for (const p of targets) {
    try {
      if (p.transaction?.txid) {
        await completePayment(p.identifier, p.transaction.txid);
        results.push({ id: p.identifier, action: 'completed' });
      } else {
        await cancelPayment(p.identifier);
        results.push({ id: p.identifier, action: 'cancelled' });
      }
    } catch (e) {
      results.push({ id: p.identifier, action: 'error', error: String(e) });
    }
  }
  return ok({ resolved: results.length, results });
});
