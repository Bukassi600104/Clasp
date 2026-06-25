import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { getTrade } from '@/lib/store';
import { getPayment, approvePayment } from '@/lib/pi-server';
import { buyerLockTotal, microToPi } from '@/lib/escrow';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({ paymentId: z.string().min(4), tradeId: z.string().min(8) });

/**
 * Server-side payment approval (PRD §11). We re-derive the expected lock amount
 * (price + buyer bond) from the trade and refuse to approve a payment whose
 * amount does not match — the client cannot dictate how much is locked.
 */
export const POST = handler(async (req: NextRequest) => {
  requireSession();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('paymentId and tradeId are required.');

  const trade = await getTrade(parsed.data.tradeId);
  if (!trade) return fail('Trade not found.', 404);
  const expected = microToPi(buyerLockTotal(BigInt(trade.amount_micro)));

  // Reaching this route means a REAL Pi Browser payment that needs server-side
  // approval. Without the Platform API key we cannot approve it, and the wallet
  // would otherwise hang at "Preparing for a payment…" until it expires. Fail
  // loudly so the cause is obvious rather than a silent 60s timeout.
  if (!process.env.PI_API_KEY) {
    console.error('[clasp] PI_API_KEY is not set — cannot approve Pi payments. Set it in the deployment environment.');
    return fail('Payments are not available right now. Please try again shortly.', 503);
  }

  const payment = await getPayment(parsed.data.paymentId);
  if (Math.abs(payment.amount - expected) > 1e-6) {
    return fail('Payment amount does not match the trade lock amount.', 409);
  }
  await approvePayment(parsed.data.paymentId);
  return ok({ approved: true, expected });
});
