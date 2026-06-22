import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import type { SessionUser } from './types';

/**
 * Stateless signed-cookie session. After the Pi access token is verified
 * server-side (lib/pi-server.verifyAccessToken), we mint a short HMAC-signed
 * cookie carrying only the Pi uid + username — never tokens, never keys.
 */

const COOKIE = 'clasp_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// SECURITY (A02/A07): never fall back to a known default in production. A
// predictable signing key would let anyone forge a session for any uid (full
// account impersonation). In prod the secret is required; locally we allow a
// dev placeholder for convenience.
const SECRET =
  process.env.SESSION_SECRET ||
  (process.env.NODE_ENV === 'production' ? null : 'dev-insecure-secret-change-me');

function sign(payload: string): string {
  if (!SECRET) throw new Error('SESSION_SECRET is not configured.');
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function encode(user: SessionUser): string {
  const body = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + MAX_AGE * 1000 })
  ).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decode(token: string): SessionUser | null {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { uid: data.uid, username: data.username };
  } catch {
    return null;
  }
}

// SECURITY: Pi embeds the app in a third-party <iframe> on pinet.com, so the
// session cookie is a third-party cookie. Mobile Pi Browser blocks third-party
// cookies by default — `Partitioned` (CHIPS) is required so the cookie is kept
// and sent within the Pi top-level partition. Desktop worked without it because
// its webview allows third-party cookies; mobile does not.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  partitioned: true,
  path: '/',
} as const;

export function setSession(user: SessionUser) {
  cookies().set(COOKIE, encode(user), { ...COOKIE_OPTS, maxAge: MAX_AGE });
}

export function clearSession() {
  // Clear in the same partition with matching attributes.
  cookies().set(COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
}

export function getSession(): SessionUser | null {
  const token = cookies().get(COOKIE)?.value;
  return token ? decode(token) : null;
}

export function requireSession(): SessionUser {
  const s = getSession();
  if (!s) throw new SessionError();
  return s;
}

export class SessionError extends Error {
  constructor() {
    super('Authentication required.');
  }
}
