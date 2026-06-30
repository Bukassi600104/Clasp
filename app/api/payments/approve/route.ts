import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { getTrade } from '@/lib/store';
import { getPayment, approvePayment } from '@/lib/pi-server';
import { buyerLockTotal, sellerLockTotal, microToPi } from '@/lib/escrow';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({
  paymentId: z.string().min(4),
  tradeId: z.string().min(8),
  // 'seller_bond' = the seller posting their bond at creation; default funding.
  kind: z.enum(['escrow_lock', 'seller_bond']).optional(),
});

/**
 * Server-side payment approval (PRD §11). We re-derive the expected lock amount
 * (price + buyer bond) from the trade and refuse to approve a payment whose
 * amount does not match — the client cannot dictate how much is locked.
 */
export const POST = handler(async (req: NextRequest) => {
  const session = requireSession();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('paymentId and tradeId are required.');

  // Reaching this route means a REAL Pi Browser payment that needs server-side
  // approval. Without the Platform API key we cannot approve it, and the wallet
  // would otherwise hang at "Preparing for a payment…" until it expires. Fail
  // loudly so the cause is obvious rather than a silent 60s timeout.
  if (!process.env.PI_API_KEY) {
    console.error('[clasp] PI_API_KEY is not set — cannot approve Pi payments. Set it in the deployment environment.');
    return fail('Payments are not available right now. Please try again shortly.', 503);
  }

  console.log(`[clasp] approve START payment=${parsed.data.paymentId} trade=${parsed.data.tradeId}`);
  // The two reads are independent — run them together so we spend the Pi
  // approval window on one round-trip's worth of latency, not two. (The wallet
  // gives a short window; a cold function doing sequential I/O can blow it.)
  let trade, payment;
  try {
    [trade, payment] = await Promise.all([
      getTrade(parsed.data.tradeId),
      getPayment(parsed.data.paymentId),
    ]);
  } catch (e) {
    // A 404 from getPayment is the classic "developer failed to approve" cause:
    // the Pi Platform API (using PI_API_KEY) cannot see this payment, meaning
    // PI_API_KEY belongs to a DIFFERENT Pi app/network than the one that created
    // the payment in the user's Pi Browser. Retrying never helps — say so loudly.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('(404)')) {
      console.error(
        `[clasp] approve PAYMENT-NOT-FOUND payment=${parsed.data.paymentId}: Pi API returned 404. ` +
        `PI_API_KEY does not match the Pi app registered for this URL (wrong app or wrong network). ` +
        `Set PI_API_KEY to the API key of the SAME portal app that hosts this domain.`
      );
      return fail('This payment could not be verified with Pi. Please contact support.', 502);
    }
    throw e;
  }
  if (!trade) return fail('Trade not found.', 404);
  const isBond = parsed.data.kind === 'seller_bond';
  if (isBond && session.uid !== trade.seller_uid) {
    return fail('Only the seller can post the seller bond.', 403);
  }
  // Seller bond = just the bond; buyer funding = price + bond (+ fee if buyer pays).
  const amountMicro = BigInt(trade.amount_micro);
  const expected = microToPi(
    isBond ? sellerLockTotal(amountMicro) : buyerLockTotal(amountMicro, trade.fee_payer)
  );
  console.log(`[clasp] approve expected=${expected} payment.amount=${payment.amount} status=${JSON.stringify(payment.status)}`);
  if (Math.abs(payment.amount - expected) > 1e-6) {
    console.error(`[clasp] approve AMOUNT MISMATCH pi=${payment.amount} expected=${expected}`);
    return fail('Payment amount does not match the trade lock amount.', 409);
  }
  await approvePayment(parsed.data.paymentId);
  console.log(`[clasp] approve OK payment=${parsed.data.paymentId}`);
  return ok({ approved: true, expected });
});
