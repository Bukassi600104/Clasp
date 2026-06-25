import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { getOwnProfileView, setSellerLimit } from '@/lib/store';
import { handler, ok, fail, limited } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** GET /api/profile — the caller's own stats, tier, per-trade cap, and reviews. */
export const GET = handler(async () => {
  const session = requireSession();
  const data = await getOwnProfileView(session.uid);
  return ok(data);
});

const LimitBody = z.object({
  // null = request "unlimited" (granted only at Elite; otherwise clamped down).
  limitPi: z.number().positive().nullable(),
});

/** POST /api/profile — set the seller's per-trade cap (clamped to earned tier). */
export const POST = handler(async (req: NextRequest) => {
  const session = requireSession();
  const rl = await limited(req, 'profile-limit', 20, 60, session.uid);
  if (rl) return rl;
  const parsed = LimitBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid limit.');
  await setSellerLimit(session.uid, parsed.data.limitPi);
  return ok(await getOwnProfileView(session.uid));
});
