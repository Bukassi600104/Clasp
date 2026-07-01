import 'server-only';
import { repo } from './db/repo';
import { getPayment } from './pi-server';
import { bondTrade, fundTrade, isTransitionError } from './store';
import { logPayment, newRequestId } from './payment-audit';

/**
 * Automatic recovery for the "money moved but the trade was not recorded"
 * failure (AUDIT.md F3). The complete route writes a `payment_intents` doc with
 * status `completing` BEFORE acknowledging the payment with Pi; the doc flips to
 * `recorded` only after the bond/fund transition commits. Anything still
 * `completing` after a grace period is a payment whose local write was lost —
 * this sweep re-checks the payment with Pi and replays the idempotent
 * transition, so the user's funds always end up reflected in a trade.
 */
const GRACE_MS = 2 * 60 * 1000;

export async function reconcileStuckIntents(): Promise<{ scanned: number; recovered: number; failed: number }> {
  const cutoff = new Date(Date.now() - GRACE_MS).toISOString();
  const stuck = await repo().listCompletingIntents(cutoff);
  let recovered = 0;
  let failed = 0;

  for (const intent of stuck) {
    const requestId = newRequestId();
    try {
      const payment = await getPayment(intent.payment_id);
      if (payment.status.cancelled || payment.status.user_cancelled) {
        intent.status = 'failed';
        intent.last_error = 'Payment cancelled on Pi.';
        intent.updated_at = new Date().toISOString();
        await repo().upsertPaymentIntent(intent);
        logPayment({ requestId, phase: 'reconcile', paymentId: intent.payment_id, tradeId: intent.trade_id, status: 'cancelled_on_pi' });
        failed += 1;
        continue;
      }
      const txid = payment.transaction?.txid ?? intent.txid;
      if (!txid) continue; // not on chain yet; leave for the next sweep

      // Replay the recording transition. Both are idempotent, so replaying a
      // transition that actually committed is a harmless no-op.
      if (intent.kind === 'seller_bond') {
        await bondTrade(intent.trade_id, intent.uid, txid);
      } else {
        await fundTrade(intent.trade_id, intent.uid, intent.username, txid);
      }
      intent.status = 'recorded';
      intent.last_error = null;
      intent.updated_at = new Date().toISOString();
      await repo().upsertPaymentIntent(intent);
      logPayment({ requestId, phase: 'reconcile', paymentId: intent.payment_id, tradeId: intent.trade_id, status: 'ok', detail: `replayed ${intent.kind}` });
      recovered += 1;
      console.log(`[clasp] reconcile RECOVERED payment=${intent.payment_id} trade=${intent.trade_id} kind=${intent.kind}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A TransitionError here means the trade moved on legitimately (for
      // example it expired before recovery); anything else stays retryable.
      if (isTransitionError(e)) {
        intent.status = 'failed';
        failed += 1;
      }
      intent.last_error = msg;
      intent.updated_at = new Date().toISOString();
      await repo().upsertPaymentIntent(intent);
      logPayment({ requestId, phase: 'reconcile', paymentId: intent.payment_id, tradeId: intent.trade_id, status: `error`, detail: msg });
      console.error(`[clasp] reconcile intent ${intent.payment_id} failed: ${msg}`);
    }
  }
  return { scanned: stuck.length, recovered, failed };
}
