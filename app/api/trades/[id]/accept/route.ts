import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { acceptSettlement } from '@/lib/store';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({ proposalId: z.string().min(8) });

/** POST /api/trades/:id/accept — counterparty accepts a proposal → SETTLED. */
export const POST = handler(async (req: NextRequest, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('A proposal id is required.');
  const trade = await acceptSettlement(ctx.params.id, session.uid, parsed.data.proposalId);
  return ok(trade);
});
