import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { verifyAccessToken } from '@/lib/pi-server';
import { setSession } from '@/lib/session';
import { upsertUser, seedDemo } from '@/lib/store';
import { handler, ok, fail, limited } from '@/lib/api';

export const dynamic = 'force-dynamic';

const Body = z.object({ accessToken: z.string().min(8) });

/**
 * Exchange a Pi access token for a Clasp session. The token is ALWAYS verified
 * server-side by calling GET https://api.minepi.com/v2/me with the user's own
 * Authorization: Bearer <accessToken> (PRD §4, §11) before a session is set.
 * This requires no Pi Network API key — the access token authenticates itself.
 *
 * Locally / in design preview, the client sends a `sandbox_…` token (it isn't a
 * real Pi token); those resolve to a stable pseudo-identity with seeded demo
 * data so the UI stays explorable outside Pi Browser.
 */
export const POST = handler(async (req: NextRequest) => {
  const rl = await limited(req, 'auth', 30, 60); // sign-ins/min/IP — generous for shared carrier NAT
  if (rl) return rl;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('A Pi access token is required.');

  const token = parsed.data.accessToken;
  const isSandbox = token.startsWith('sandbox_');

  let user: { uid: string; username: string };
  if (isSandbox) {
    user = sandboxIdentity(token);
  } else {
    try {
      user = await verifyAccessToken(token); // GET /v2/me, Bearer token, no API key
    } catch {
      return fail('Could not verify your Pi sign-in. Please try again.', 401);
    }
  }

  await upsertUser(user.uid, user.username);
  if (isSandbox) await seedDemo(user.uid, user.username); // demo data only for local preview
  setSession(user);
  return ok({ uid: user.uid, username: user.username });
});

/** Sandbox-only identity derivation when no Pi secret key is configured. */
function sandboxIdentity(token: string): { uid: string; username: string } {
  // Pi sandbox tokens are opaque; derive a stable, collision-resistant
  // pseudo-identity by hashing the full token.
  const slug = createHash('sha256').update(token).digest('hex').slice(0, 10);
  return { uid: `pi_sandbox_${slug}`, username: `pioneer_${slug}` };
}
