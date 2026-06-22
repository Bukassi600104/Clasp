import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { proposeSettlement } from '@/lib/store';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({ sellerPct: z.number().int().min(0).max(100) });

/** POST /api/trades/:id/propose — either party proposes a split (5% steps). */
export const POST = handler(async (req: NextRequest, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('A seller percentage (0–100, in 5% steps) is required.');
  const { trade, proposal } = await proposeSettlement(ctx.params.id, session.uid, parsed.data.sellerPct);
  return ok({ trade, proposal });
});
