import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createPartner } from '@/lib/partners';
import { handler, ok, fail, limited } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({ name: z.string().trim().min(2).max(80) });

/**
 * POST /api/v1/partners — mint a partner API key. The plaintext key is returned
 * exactly once.
 *
 * SECURITY (A01/A05): issuing keys is privileged — it must always require a
 * configured ADMIN_SECRET and a matching bearer. We never allow open issuance
 * (an unset secret denies, rather than letting anyone mint keys).
 */
export const POST = handler(async (req: NextRequest) => {
  const rl = await limited(req, 'partner-issue', 10, 60); // throttle admin-secret guessing
  if (rl) return rl;
  const admin = process.env.ADMIN_SECRET;
  if (!admin) return fail('Partner key issuance is not enabled.', 403);
  if (req.headers.get('authorization') !== `Bearer ${admin}`) {
    return fail('Admin authorization required.', 401);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('A partner name is required.');

  const { partner, apiKey } = await createPartner(parsed.data.name);
  return ok(
    {
      partner_id: partner.id,
      name: partner.name,
      tier: partner.tier,
      api_key: apiKey, // shown once — store it securely
    },
    { status: 201 }
  );
});
