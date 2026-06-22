import { requireSession } from '@/lib/session';
import { openDispute } from '@/lib/store';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** POST /api/trades/:id/dispute — buyer opens a dispute within inspection window. */
export const POST = handler(async (_req: Request, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const trade = await openDispute(ctx.params.id, session.uid);
  return ok(trade);
});
