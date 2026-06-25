import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { createTrade, listTradesFor, getTradeByRef, findByIdempotency, sellerLimitInfo } from '@/lib/store';
import { piToMicro, validateCreate, PARAMS } from '@/lib/escrow';
import { handler, ok, fail, limited } from '@/lib/api';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  amount: z.number().positive(),
  shipWindowS: z.number().int().min(PARAMS.SHIP_MIN_S).max(PARAMS.SHIP_MAX_S),
  inspectWindowS: z.number().int().min(PARAMS.INSPECT_MIN_S).max(PARAMS.INSPECT_MAX_S),
  memo: z.string().trim().min(3).max(140),
  ref: z.string().max(120).optional(),
});

/** POST /api/trades — create a trade. The seller's bond is locked at creation. */
export const POST = handler(async (req: NextRequest) => {
  const session = requireSession();
  const rl = await limited(req, 'create-trade', 20, 60, session.uid); // 20/min/user
  if (rl) return rl;
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid trade details.');

  const amountMicro = piToMicro(parsed.data.amount);
  // Per-seller tier cap (replaces the old flat 50π launch cap).
  const { effectiveMicro } = await sellerLimitInfo(session.uid);
  const err = validateCreate({
    amountMicro,
    shipWindowS: parsed.data.shipWindowS,
    inspectWindowS: parsed.data.inspectWindowS,
    maxAmountMicro: effectiveMicro,
  });
  if (err) return fail(err);

  // Idempotency-Key (PRD §9): replay returns the original trade, never a dupe.
  const idemKey = req.headers.get('Idempotency-Key');
  if (idemKey) {
    const existing = await findByIdempotency(null, idemKey);
    if (existing) return ok(existing, { status: 200 });
  }

  const trade = await createTrade({
    sellerUid: session.uid,
    sellerUsername: session.username,
    amountMicro,
    shipWindowS: parsed.data.shipWindowS,
    inspectWindowS: parsed.data.inspectWindowS,
    memo: parsed.data.memo,
    ref: parsed.data.ref ?? null,
    idempotencyKey: idemKey,
  });
  return ok(trade, { status: 201 });
});

/** GET /api/trades — list the caller's trades, or ?ref= lookup. */
export const GET = handler(async (req: NextRequest) => {
  const ref = new URL(req.url).searchParams.get('ref');
  if (ref) {
    const t = await getTradeByRef(null, ref);
    return t ? ok([t]) : ok([]);
  }
  const session = requireSession();
  return ok(await listTradesFor(session.uid));
});
