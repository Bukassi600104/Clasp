import { requireSession } from '@/lib/session';
import { confirmReceipt } from '@/lib/store';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** POST /api/trades/:id/confirm — buyer confirms receipt → COMPLETED payout. */
export const POST = handler(async (_req: Request, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const trade = await confirmReceipt(ctx.params.id, session.uid);
  return ok(trade);
});
