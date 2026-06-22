import { claimTimeout } from '@/lib/store';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/trades/:id/timeout — permissionless (PRD §8.4(4)).
 * Anyone may invoke this; it executes whichever deadline transition is due
 * (REFUNDED, COMPLETED-via-silence, or NUCLEAR). No session required, so no
 * party can stall by refusing to act and a backend outage cannot strand funds.
 */
export const POST = handler(async (_req: Request, ctx: { params: { id: string } }) => {
  const trade = await claimTimeout(ctx.params.id);
  return ok(trade);
});
