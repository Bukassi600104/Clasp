import { requireSession } from '@/lib/session';
import { bondTrade } from '@/lib/store';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** POST /api/trades/:id/bond — sandbox/preview path to mark the seller bond
 *  posted without a real Pi payment. In the Pi Browser the bond is posted via the
 *  payment flow (approve/complete with kind=seller_bond) instead. */
export const POST = handler(async (_req: Request, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const trade = await bondTrade(ctx.params.id, session.uid);
  return ok(trade);
});
