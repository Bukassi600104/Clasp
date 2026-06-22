import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticatePartner } from '@/lib/partners';
import { createTrade, getTradeByRef, findByIdempotency } from '@/lib/store';
import { piToMicro, validateCreate, PARAMS } from '@/lib/escrow';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({
  amount: z.number().positive(),
  shipWindowS: z.number().int().min(PARAMS.SHIP_MIN_S).max(PARAMS.SHIP_MAX_S).optional(),
  inspectWindowS: z.number().int().min(PARAMS.INSPECT_MIN_S).max(PARAMS.INSPECT_MAX_S).optional(),
  memo: z.string().trim().min(3).max(140),
  ref: z.string().max(120).optional(),
  sellerUid: z.string().max(120).optional(),
  sellerUsername: z.string().max(80).optional(),
});

function checkoutUrl(req: NextRequest, id: string): string {
  const base = process.env.APP_URL || new URL(req.url).origin;
  return `${base}/t/${id}`;
}

/**
 * POST /api/v1/trades (PRD §9) — partner-authenticated trade creation.
 * Returns the trade plus a checkout URL the partner shares with the buyer.
 * Supports Idempotency-Key and partner reference ids.
 */
export const POST = handler(async (req: NextRequest) => {
  const partner = await authenticatePartner(req);
  if (!partner) return fail('Invalid or missing partner API key.', 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid trade details.');

  const amountMicro = piToMicro(parsed.data.amount);
  const shipWindowS = parsed.data.shipWindowS ?? PARAMS.SHIP_DEFAULT_S;
  const inspectWindowS = parsed.data.inspectWindowS ?? PARAMS.INSPECT_DEFAULT_S;
  const err = validateCreate({ amountMicro, shipWindowS, inspectWindowS });
  if (err) return fail(err);

  const idemKey = req.headers.get('Idempotency-Key');
  if (idemKey) {
    const existing = await findByIdempotency(partner.id, idemKey);
    if (existing) return ok({ trade: existing, checkout_url: checkoutUrl(req, existing.id) });
  }

  const trade = await createTrade({
    sellerUid: parsed.data.sellerUid ?? `partner:${partner.id}`,
    sellerUsername: parsed.data.sellerUsername ?? partner.name,
    amountMicro,
    shipWindowS,
    inspectWindowS,
    memo: parsed.data.memo,
    partnerId: partner.id,
    ref: parsed.data.ref ?? null,
    idempotencyKey: idemKey,
  });
  return ok({ trade, checkout_url: checkoutUrl(req, trade.id) }, { status: 201 });
});

/** GET /api/v1/trades?ref= — partner lookup by their reference id. */
export const GET = handler(async (req: NextRequest) => {
  const partner = await authenticatePartner(req);
  if (!partner) return fail('Invalid or missing partner API key.', 401);
  const ref = new URL(req.url).searchParams.get('ref');
  if (!ref) return fail('A ref query parameter is required.');
  const trade = await getTradeByRef(partner.id, ref);
  return trade ? ok([trade]) : ok([]);
});
