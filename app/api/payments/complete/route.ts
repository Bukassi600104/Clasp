import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { fundTrade, bondTrade } from '@/lib/store';
import { completePayment } from '@/lib/pi-server';
import { repo } from '@/lib/db/repo';
import { logPayment, newRequestId } from '@/lib/payment-audit';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({
  paymentId: z.string().min(4),
  txid: z.string().min(4),
  tradeId: z.string().min(8),
  kind: z.enum(['escrow_lock', 'seller_bond']).optional(),
});

/**
 * Server-side payment completion (PRD §11). Order matters for crash safety:
 *  1. persist a `payment_intents` record (status `completing`) — durable proof
 *     that this payment belongs to this trade, BEFORE any acknowledgement;
 *  2. acknowledge the payment with Pi (`/complete` with the txid);
 *  3. record the bond/fund transition (idempotent, transactional);
 *  4. flip the intent to `recorded`.
 * If step 3 or 4 dies, the intent stays `completing` and lib/reconcile.ts
 * replays the transition automatically — funds can no longer move without a
 * matching trade record.
 */
export const POST = handler(async (req: NextRequest) => {
  const session = requireSession();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('paymentId, txid and tradeId are required.');

  if (!process.env.PI_API_KEY) {
    console.error('[clasp] PI_API_KEY is not set — cannot complete Pi payments.');
    return fail('Payments are not available right now. Please try again shortly.', 503);
  }

  const { paymentId, txid, tradeId } = parsed.data;
  const kind = parsed.data.kind === 'seller_bond' ? 'seller_bond' : 'escrow_lock';
  const requestId = newRequestId();
  console.log(`[clasp] complete START rid=${requestId} payment=${paymentId} trade=${tradeId} kind=${kind} txid=${txid} uid=${session.uid}`);

  // 1. Durable intent, before anything can be lost.
  await repo().upsertPaymentIntent({
    payment_id: paymentId,
    trade_id: tradeId,
    kind,
    uid: session.uid,
    username: session.username,
    txid,
    status: 'completing',
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // 2. Acknowledge with Pi. The on-chain transfer already happened when the
  //    user signed; this finalizes the payment on Pi's side.
  try {
    await completePayment(paymentId, txid);
    logPayment({ requestId, phase: 'complete', paymentId, tradeId, status: 'pi_complete_ok' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logPayment({ requestId, phase: 'complete', paymentId, tradeId, status: 'pi_complete_error', detail: msg });
    throw e;
  }

  // 3 + 4. Record the transition, then mark the intent recorded. A failure here
  // is loud but no longer lossy: the reconciler replays it from the intent.
  try {
    const trade = kind === 'seller_bond'
      ? await bondTrade(tradeId, session.uid, txid)
      : await fundTrade(tradeId, session.uid, session.username, txid);
    const intent = await repo().getPaymentIntent(paymentId);
    if (intent) {
      intent.status = 'recorded';
      intent.updated_at = new Date().toISOString();
      await repo().upsertPaymentIntent(intent);
    }
    logPayment({ requestId, phase: 'complete', paymentId, tradeId, status: 'ok', detail: `${kind} recorded, state=${trade.state}` });
    console.log(`[clasp] complete ${kind === 'seller_bond' ? 'BONDED' : 'FUNDED'} rid=${requestId} trade=${trade.id} state=${trade.state}`);
    return ok(trade);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logPayment({ requestId, phase: 'complete', paymentId, tradeId, status: 'record_error', detail: msg });
    console.error(
      `[clasp] complete RECORD-FAILED rid=${requestId} trade=${tradeId} txid=${txid} uid=${session.uid}: ${msg} ` +
      `— funds moved on-chain; the payment intent stays 'completing' and the reconciler will replay it.`
    );
    throw e;
  }
});
