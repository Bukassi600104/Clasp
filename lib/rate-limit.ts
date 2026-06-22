import 'server-only';
import { db, firebaseConfigured } from './firebase';

/**
 * Fixed-window rate limiter (defence against abuse / brute force / spam — OWASP
 * A04, A07). Uses Firestore for a shared counter across serverless instances
 * when Firebase is configured; falls back to an in-process counter otherwise
 * (best-effort per warm instance). Fail-open on storage errors so a limiter
 * outage never blocks legitimate users.
 */

export interface RateResult {
  ok: boolean;
  retryAfter: number; // seconds until the window resets
  remaining: number;
}

const mem = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));

  if (firebaseConfigured()) {
    try {
      const ref = db().collection('rate_limits').doc(`${key}:${windowStart}`);
      const count = await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const c = ((snap.exists ? (snap.data()?.count as number) : 0) || 0) + 1;
        // expireAt supports a Firestore TTL policy so old windows self-clean.
        tx.set(ref, { count: c, expireAt: new Date(resetAt + windowMs) }, { merge: true });
        return c;
      });
      return { ok: count <= limit, retryAfter, remaining: Math.max(0, limit - count) };
    } catch {
      // fall through to in-memory on any Firestore hiccup (fail-open)
    }
  }

  const entry = mem.get(key);
  if (!entry || entry.resetAt <= now) {
    mem.set(key, { count: 1, resetAt });
    if (mem.size > 10_000) for (const [k, v] of mem) if (v.resetAt <= now) mem.delete(k);
    return { ok: 1 <= limit, retryAfter, remaining: limit - 1 };
  }
  entry.count += 1;
  return { ok: entry.count <= limit, retryAfter, remaining: Math.max(0, limit - entry.count) };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  );
}
