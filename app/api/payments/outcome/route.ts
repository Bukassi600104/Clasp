import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { logPayment, newRequestId } from '@/lib/payment-audit';
import { handler, ok, fail, limited } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({
  paymentId: z.string().min(1).max(120),
  tradeId: z.string().max(64).optional(),
  outcome: z.enum(['cancelled', 'error']),
  detail: z.string().max(500).optional(),
});

/**
 * Persist client-side Pi payment outcomes (PRD §11, AUDIT.md Phase 3 item 2).
 * `onCancel` and `onError` fire only in the user's browser; without this record
 * an abandoned payment is invisible server-side. Diagnostic writes only — no
 * state transitions happen here, so a forged call cannot affect any trade.
 */
export const POST = handler(async (req: NextRequest) => {
  const session = requireSession();
  const rl = await limited(req, 'pay-outcome', 30, 60, session.uid);
  if (rl) return rl;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('paymentId and outcome are required.');

  logPayment({
    requestId: newRequestId(),
    phase: 'client',
    paymentId: parsed.data.paymentId,
    tradeId: parsed.data.tradeId ?? null,
    status: parsed.data.outcome,
    detail: `${session.uid}: ${parsed.data.detail ?? ''}`.slice(0, 500),
  });
  return ok({ logged: true });
});
