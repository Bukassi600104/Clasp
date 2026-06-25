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
  await completePayment(parsed.data.paymentId, parsed.data.txid);
  const trade = await fundTrade(parsed.data.tradeId, session.uid, session.username, parsed.data.txid);
  return ok(trade);
});
