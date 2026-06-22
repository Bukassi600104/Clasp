import { requireSession } from '@/lib/session';
import { cancelUnfunded } from '@/lib/store';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** POST /api/trades/:id/cancel — seller cancels an unfunded trade. */
export const POST = handler(async (_req: Request, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const trade = await cancelUnfunded(ctx.params.id, session.uid);
  return ok(trade);
});
