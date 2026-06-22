import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getPayment, completePayment, cancelPayment } from '@/lib/pi-server';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({ paymentId: z.string().min(4) });

/**
 * Reconcile an incomplete payment surfaced by Pi.authenticate's
 * onIncompletePaymentFound callback. If the chain transaction exists we
 * complete it; otherwise we cancel so nothing is left hanging.
 */
export const POST = handler(async (req: NextRequest) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('paymentId is required.');
  if (!process.env.PI_API_KEY) return ok({ reconciled: 'skipped' });

  const payment = await getPayment(parsed.data.paymentId);
  if (payment.transaction?.txid) {
    await completePayment(parsed.data.paymentId, payment.transaction.txid);
    return ok({ reconciled: 'completed' });
  }
  await cancelPayment(parsed.data.paymentId);
  return ok({ reconciled: 'cancelled' });
});
