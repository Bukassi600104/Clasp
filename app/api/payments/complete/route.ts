import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { fundTrade } from '@/lib/store';
import { completePayment } from '@/lib/pi-server';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({
  paymentId: z.string().min(4),
  txid: z.string().min(4),
  tradeId: z.string().min(8),
});

/**
 * Server-side payment completion (PRD §11). We complete the payment with the
 * Pi Platform API, then record the funding transition bound to the on-chain txid.
 * The fund transition itself enforces state + authorization guards.
 */
export const POST = handler(async (req: NextRequest) => {
  const session = requireSession();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('paymentId, txid and tradeId are required.');

  if (!process.env.PI_API_KEY) {
    console.error('[clasp] PI_API_KEY is not set — cannot complete Pi payments.');
    return fail('Payments are not available right now. Please try again shortly.', 503);
  }

  console.log(`[clasp] complete START payment=${parsed.data.paymentId} trade=${parsed.data.tradeId} txid=${parsed.data.txid} uid=${session.uid}`);
  // The on-chain transfer already happened when the user signed; acknowledge it
  // with Pi first so the payment is finalized on their side.
  await completePayment(parsed.data.paymentId, parsed.data.txid);
  console.log(`[clasp] complete Pi/complete OK payment=${parsed.data.paymentId}`);

  // Record the funding. If THIS fails, money has moved but the trade is unrecorded
  // — the exact failure we hit. Log it loudly (with the reason) so it's never
  // silent, and so the next attempt is diagnosable from the server logs.
  try {
    const trade = await fundTrade(parsed.data.tradeId, session.uid, session.username, parsed.data.txid);
    console.log(`[clasp] complete FUNDED trade=${trade.id} state=${trade.state} buyer=${trade.buyer_uid} seller=${trade.seller_uid}`);
    return ok(trade);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[clasp] complete FUND-FAILED trade=${parsed.data.tradeId} txid=${parsed.data.txid} uid=${session.uid}: ${msg} ` +
      `— FUNDS MOVED on-chain but the trade was NOT recorded. This needs reconciliation.`
    );
    throw e;
  }
});
