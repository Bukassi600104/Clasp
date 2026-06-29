import { requireSession } from '@/lib/session';
import { reactivateTrade } from '@/lib/store';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** POST /api/trades/:id/reactivate — seller relists an expired/cancelled,
 *  never-funded trade with a fresh funding window (no need to recreate it). */
export const POST = handler(async (_req: Request, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const trade = await reactivateTrade(ctx.params.id, session.uid);
  return ok(trade);
});
