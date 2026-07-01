import 'server-only';
import { firebaseConfigured } from './firebase';

/**
 * Fail-fast environment validation (AUDIT.md F8). Runs once per server instance,
 * from the shared route `handler()` wrapper, and throws a single message naming
 * every problem instead of letting a misconfigured deploy limp along and fail in
 * confusing ways later — the worst being the silent in-memory fallback on
 * serverless, where trades write to instance RAM and simply vanish.
 */

let checked = false;

export function assertServerEnv(): void {
  if (checked) return;
  checked = true;

  const prod = process.env.NODE_ENV === 'production';
  const onVercel = !!process.env.VERCEL;
  const problems: string[] = [];

  if (prod && !process.env.SESSION_SECRET) {
    problems.push('SESSION_SECRET is not set. Sessions cannot be signed. Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"');
  } else if (prod && (process.env.SESSION_SECRET ?? '').length < 16) {
    problems.push('SESSION_SECRET is too short (need at least 16 chars).');
  }

  if (onVercel && prod && !firebaseConfigured()) {
    problems.push(
      'No Firestore configured (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY). ' +
      'On serverless the in-memory fallback loses every trade when the instance recycles. Refusing to run.'
    );
  }

  const seed = process.env.PI_WALLET_PRIVATE_SEED;
  if (seed && !/^S[A-Z2-7]{55}$/.test(seed)) {
    problems.push('PI_WALLET_PRIVATE_SEED is malformed (expected a 56-char Stellar secret starting with "S"). Payout signing would fail.');
  }

  const key = process.env.PI_API_KEY;
  if (prod && key && key.length < 20) {
    problems.push('PI_API_KEY looks truncated (under 20 chars). Check the value copied from the Pi Developer Portal.');
  }

  const pk = process.env.FIREBASE_PRIVATE_KEY;
  if (pk && !pk.includes('BEGIN PRIVATE KEY')) {
    problems.push('FIREBASE_PRIVATE_KEY does not contain a PEM header. Paste the full key including -----BEGIN PRIVATE KEY----- with \\n escapes.');
  }

  if (problems.length > 0) {
    const msg = `[clasp] environment misconfigured:\n - ${problems.join('\n - ')}`;
    if (prod) throw new Error(msg);
    console.warn(`${msg}\n(continuing because NODE_ENV is not production)`);
  }
}
