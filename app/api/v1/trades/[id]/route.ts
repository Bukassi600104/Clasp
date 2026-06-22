import { authenticatePartner } from '@/lib/partners';
import { getTrade, getEvents } from '@/lib/store';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** GET /api/v1/trades/:id (PRD §9) — state, deadlines, amounts, event history. */
export const GET = handler(async (req: Request, ctx: { params: { id: string } }) => {
  const partner = await authenticatePartner(req);
  if (!partner) return fail('Invalid or missing partner API key.', 401);

  const trade = await getTrade(ctx.params.id);
  if (!trade) return fail('Trade not found.', 404);
  if (trade.partner_id !== partner.id) return fail('Trade not found.', 404);

  return ok({ trade, events: await getEvents(trade.id) });
});
