import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';
import { addEvidence } from '@/lib/store';
import { handler, ok, fail, limited } from '@/lib/api';

export const dynamic = 'force-dynamic';

// ~700KB cap keeps a base64 image safely under Firestore's 1MB document limit.
// In production this path holds a Firebase Storage object path instead.
const MAX_LEN = 700_000;

const Body = z.object({
  caption: z.string().trim().max(200).optional(),
  image: z.string().max(MAX_LEN).optional(), // data URL (image/*) or storage path
});

/**
 * POST /api/trades/:id/evidence — a party attaches dispute evidence
 * (an image and/or a note). Authorization is enforced in the store.
 */
export const POST = handler(async (req: NextRequest, ctx: { params: { id: string } }) => {
  const session = requireSession();
  const rl = await limited(req, 'evidence', 30, 60, session.uid);
  if (rl) return rl;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Evidence is too large or malformed.');
  if (!parsed.data.image && !parsed.data.caption) return fail('Add a note or an image.');
  if (parsed.data.image && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(parsed.data.image))
    return fail('Image must be a PNG, JPG, WEBP or GIF.');

  const storagePath = parsed.data.image ?? 'note';
  const evidence = await addEvidence(ctx.params.id, session.uid, storagePath, parsed.data.caption ?? null);
  return ok(evidence, { status: 201 });
});
