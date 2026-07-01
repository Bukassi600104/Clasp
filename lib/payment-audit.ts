import 'server-only';
import { randomUUID } from 'crypto';
import { repo } from './db/repo';

/**
 * Append-only audit trail for Pi payment verification (AUDIT.md F4). Every
 * approve/complete/reconcile attempt lands in `payment_logs` with a request id,
 * outcome status and timestamp, so a stuck payment is diagnosable from the
 * database rather than from ephemeral function logs. Logging must never break a
 * payment, so failures are swallowed after a console note.
 */
export function logPayment(entry: {
  requestId: string;
  phase: 'approve' | 'complete' | 'reconcile';
  paymentId: string;
  tradeId?: string | null;
  status: string;
  detail?: string | null;
}): void {
  void repo()
    .addPaymentLog({
      id: randomUUID(),
      request_id: entry.requestId,
      phase: entry.phase,
      payment_id: entry.paymentId,
      trade_id: entry.tradeId ?? null,
      status: entry.status,
      detail: entry.detail ?? null,
      at: new Date().toISOString(),
    })
    .catch((e) => console.error('[clasp] payment log write failed:', e));
}

export const newRequestId = () => randomUUID();
