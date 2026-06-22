import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticatePartner, registerWebhook } from '@/lib/partners';
import { handler, ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({
  url: z.string().url(),
  secret: z.string().min(8).max(128).optional(),
});

/**
 * POST /api/v1/webhooks (PRD §9) — register the partner's webhook endpoint.
 * Events are signed with HMAC-SHA256 using `secret` and delivered with retries.
 */
export const POST = handler(async (req: NextRequest) => {
  const partner = await authenticatePartner(req);
  if (!partner) return fail('Invalid or missing partner API key.', 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('A valid https webhook url is required.');

  const updated = await registerWebhook(partner.id, parsed.data.url, parsed.data.secret ?? null);
  if (!updated) return fail('Partner not found.', 404);

  return ok({
    registered: true,
    url: updated.webhook_url,
    signed: !!updated.webhook_secret,
    events: [
      'trade.created', 'trade.funded', 'trade.shipped', 'trade.completed',
      'trade.disputed', 'trade.settlement_proposed', 'trade.settled',
      'trade.refunded', 'trade.nuclear', 'trade.cancelled',
    ],
  });
});
