import { NextRequest, NextResponse } from 'next/server';
import { tradesNeedingReminder } from '@/lib/store';
import { retryDueWebhooks } from '@/lib/webhooks';
import { processPendingPayouts } from '@/lib/payouts';
import { payoutsEnabled } from '@/lib/pi-payout';

export const dynamic = 'force-dynamic';
// May submit on-chain payouts — allow time to drain the queue.
export const maxDuration = 300;

/**
 * Hourly worker (PRD §11): deadline reminders + webhook retries.
 * Reminders are courtesy only — missing them never changes outcomes, since
 * timeouts are permissionless on-chain. Protected by CRON_SECRET when set.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const trades = await tradesNeedingReminder();
  let reminded = 0;
  for (const t of trades) {
    const deadline =
      t.state === 'CREATED' ? t.funding_deadline :
      t.state === 'FUNDED' ? t.ship_deadline :
      t.state === 'SHIPPED' ? t.inspect_deadline :
      t.state === 'DISPUTED' ? t.settlement_deadline : null;
    if (!deadline) continue;
    const left = new Date(deadline).getTime() - Date.now();
    if (left > 0 && left <= 24 * 3600 * 1000) reminded += 1;
  }

  const webhooksRetried = await retryDueWebhooks();
  // Daily backstop for custodial payouts (Hobby allows only daily crons). Prompt
  // settlement during the day is driven by POST /api/admin/payouts; on Pro, add a
  // frequent /api/cron/payouts schedule instead.
  const payouts = payoutsEnabled() ? await processPendingPayouts() : { skipped: true };

  return NextResponse.json({ ok: true, scanned: trades.length, reminded, webhooksRetried, payouts });
}
