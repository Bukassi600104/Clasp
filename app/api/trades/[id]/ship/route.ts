import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createHash } from 'crypto';
import { requireSession } from '@/lib/session';
import { markShipped } from '@/lib/store';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({
  evidenceNote: z.string().trim().min(3).max(280),
});

/**
 * POST /api/trades/:id/ship — seller marks shipped with evidence.
 * Per PRD §8.5 the evidence_hash is required so a false "shipped" claim is
 * provable and drags a scam-seller into a dispute they cannot win.
 */
export const POST = handler(async (req: NextRequest, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Describe what you shipped (tracking, photo ref, or note).');
  const evidenceHash = createHash('sha256').update(parsed.data.evidenceNote).digest('hex');
  const trade = await markShipped(ctx.params.id, session.uid, evidenceHash);
  return ok(trade);
});
