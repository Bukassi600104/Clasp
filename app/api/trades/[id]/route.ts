import { getTrade, getEvents, getProposals, getEvidence, getPublicStats } from '@/lib/store';
import { getSession } from '@/lib/session';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/trades/:id — full trade view: state, deadlines, amounts, history.
 * The trade id is an unguessable capability (the shareable checkout link), so
 * terms are viewable by anyone holding it. SECURITY (A01): dispute evidence
 * (photos, which may contain personal detail) is returned ONLY to the buyer or
 * seller, never to an arbitrary link-holder.
 */
export const GET = handler(async (_req: Request, ctx: { params: { id: string } }) => {
  const trade = await getTrade(ctx.params.id);
  if (!trade) return fail('Trade not found.', 404);

  const session = getSession();
  const isParty =
    !!session && (session.uid === trade.seller_uid || session.uid === trade.buyer_uid);

  const [events, proposals, evidence, sellerStats, buyerStats] = await Promise.all([
    getEvents(trade.id),
    getProposals(trade.id),
    isParty ? getEvidence(trade.id) : Promise.resolve([]),
    getPublicStats(trade.seller_uid),
    trade.buyer_uid ? getPublicStats(trade.buyer_uid) : Promise.resolve(null),
  ]);
  return ok({ trade, events, proposals, evidence, sellerStats, buyerStats });
});
