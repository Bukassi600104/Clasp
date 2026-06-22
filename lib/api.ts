import 'server-only';
import { NextResponse } from 'next/server';
import { SessionError } from './session';
import { isTransitionError } from './store';
import { rateLimit, clientIp } from './rate-limit';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Enforce a rate limit for a request. Returns a 429 Response (with Retry-After)
 * when the caller is over the limit, or null to proceed. `bucket` namespaces the
 * endpoint; the key is bucket + client IP (pass `id` to scope per user/partner).
 */
export async function limited(
  req: Request,
  bucket: string,
  limit: number,
  windowSec: number,
  id?: string
): Promise<Response | null> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return null; // test/CI bypass
  const key = `${bucket}:${id ?? clientIp(req)}`;
  const r = await rateLimit(key, limit, windowSec);
  if (r.ok) return null;
  return NextResponse.json(
    { ok: false, error: 'Too many requests — please slow down and try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(r.retryAfter) } }
  );
}

/** Wrap a route handler with uniform error handling. */
export function handler<T extends unknown[]>(
  fn: (...args: T) => Promise<Response>
) {
  return async (...args: T): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof SessionError) return fail('Sign in with Pi to continue.', 401);
      if (isTransitionError(e)) return fail(e.message, 409);
      // SECURITY (A09/A05): log details server-side, return a generic message —
      // never leak internal/DB/stack details to the client.
      console.error('[clasp] unhandled error:', e);
      return fail('Something went wrong. Please try again.', 500);
    }
  };
}
