import { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { repo } from '@/lib/db/repo';
import { processPendingPayouts } from '@/lib/payouts';
import { payoutsEnabled } from '@/lib/pi-payout';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// SECURITY (A07): constant-time secret comparison (see admin/payments).
function secretsMatch(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function authed(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return token.length > 0 && secretsMatch(token, secret);
}

/**
 * Admin payout console (ADMIN_SECRET-guarded).
 *  GET  → payout config + pending payouts (status, amount, txid, last error).
 *  POST → drain pending payouts now (manual trigger / ops reconciliation).
 */
export const GET = handler(async (req: NextRequest) => {
  if (!authed(req)) return fail('Unauthorized.', 401);
  const pending = await repo().listPendingPayouts();
  return ok({
    enabled: payoutsEnabled(),
    pending: pending.length,
    payouts: pending.map((p) => ({
      id: p.id, role: p.role, uid: p.uid, amount_micro: p.amount_micro,
      reason: p.reason, status: p.status, payment_id: p.payment_id, txid: p.txid,
      attempts: p.attempts, error: p.error,
    })),
  });
});

export const POST = handler(async (req: NextRequest) => {
  if (!authed(req)) return fail('Unauthorized.', 401);
  if (!payoutsEnabled()) return fail('Payouts not configured (PI_WALLET_PRIVATE_SEED missing).', 503);
  const result = await processPendingPayouts();
  return ok(result);
});
