import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { rateCounterparty } from '@/lib/store';
import { handler, ok, fail, limited } from '@/lib/api';

export const dynamic = 'force-dynamic';

const RateBody = z.object({
  positive: z.boolean(),
  comment: z.string().trim().max(280).optional(),
});

/**
 * POST /api/trades/:id/rate — leave 👍/👎 feedback on the counterparty after a
 * terminal trade. One rating per party per trade; the store enforces eligibility
 * + no-self-rate.
 */
export const POST = handler(async (req: NextRequest, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const rl = await limited(req, 'rate', 30, 60, session.uid); // 30/min/user
  if (rl) return rl;
  const parsed = RateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid feedback.');

  const rating = await rateCounterparty(
    ctx.params.id, session.uid, session.username,
    parsed.data.positive, parsed.data.comment ?? null,
  );
  return ok(rating, { status: 201 });
});
