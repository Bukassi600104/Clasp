import { NextRequest, NextResponse } from 'next/server';
import { processPendingPayouts } from '@/lib/payouts';
import { payoutsEnabled } from '@/lib/pi-payout';
import { reconcileStuckIntents } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';
// A2U submits an on-chain transfer per payout — give the function room to drain a
// batch without the platform timing it out mid-transfer.
export const maxDuration = 300;

/**
 * Settlement worker: drains pending custodial App-to-User payouts (seller
 * proceeds, buyer refunds/bonds) onto the Pi blockchain. Idempotent and
 * resumable (see lib/payouts.ts) so re-runs never double-pay. CRON_SECRET-guarded.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Recover any payment whose local record was lost mid-completion, then drain
  // payouts. Reconcile runs even when payouts are gated: it repairs U2A records
  // and needs only PI_API_KEY.
  let reconciled: unknown = null;
  if (process.env.PI_API_KEY) {
    try {
      reconciled = await reconcileStuckIntents();
    } catch (e) {
      console.error('[clasp] intent reconcile failed:', e);
    }
  }
  if (!payoutsEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'payouts_not_configured', reconciled });
  }
  const result = await processPendingPayouts();
  return NextResponse.json({ ok: true, ...result, reconciled });
}
