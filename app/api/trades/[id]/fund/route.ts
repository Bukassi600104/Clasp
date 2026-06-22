import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { fundTrade } from '@/lib/store';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({ txid: z.string().optional() });

/**
 * POST /api/trades/:id/fund — buyer locks price + buyer bond.
 * In production this is reached only after the Pi payment is completed
 * server-side; the txid binds the on-chain lock to the trade.
 */
export const POST = handler(async (req: NextRequest, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const body = Body.safeParse(await req.json().catch(() => ({})));
  const txid = body.success ? body.data.txid : undefined;
  const trade = await fundTrade(ctx.params.id, session.uid, session.username, txid);
  return ok(trade);
});
