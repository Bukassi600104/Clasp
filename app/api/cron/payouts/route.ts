import { NextRequest, NextResponse } from 'next/server';
import { processPendingPayouts } from '@/lib/payouts';
import { payoutsEnabled } from '@/lib/pi-payout';

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
  if (!payoutsEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'payouts_not_configured' });
  }
  const result = await processPendingPayouts();
  return NextResponse.json({ ok: true, ...result });
}
