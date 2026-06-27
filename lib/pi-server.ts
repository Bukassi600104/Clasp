import 'server-only';

/**
 * Server-side Pi Platform API client. The secret API key (PI_API_KEY) lives only
 * here and is never shipped to the browser (PRD §4, §11). Used to:
 *  - verify a pioneer's access token (/me)
 *  - approve and complete payments server-side
 *
 * Network failures are surfaced to callers; we never optimistically trust client
 * claims about payment state.
 */

const PI_API_BASE = process.env.PI_API_BASE || 'https://api.minepi.com';
const PI_API_KEY = process.env.PI_API_KEY;

// Pi's wallet only waits a short window for the developer to approve/complete a
// payment. If the Pi API hangs, a serverless function with no timeout would sit
// there until the platform limit, silently blowing that window. Cap each call so
// it fails fast with a clear error instead.
const PI_TIMEOUT_MS = 12_000;
function piSignal(): AbortSignal {
  return AbortSignal.timeout(PI_TIMEOUT_MS);
}

function authHeader(): string {
  if (!PI_API_KEY) {
    throw new Error('PI_API_KEY is not configured on the server.');
  }
  return `Key ${PI_API_KEY}`;
}

export interface PiMe {
  uid: string;
  username: string;
}

/** Verify an access token by calling /v2/me with the user's bearer token. */
export async function verifyAccessToken(accessToken: string): Promise<PiMe> {
  const res = await fetch(`${PI_API_BASE}/v2/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: piSignal(),
  });
  if (!res.ok) {
    throw new Error(`Pi token verification failed (${res.status}).`);
  }
  const data = (await res.json()) as PiMe;
  return { uid: data.uid, username: data.username };
}

export interface PiPayment {
  identifier: string;
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
  transaction: { txid: string; verified: boolean; _link: string } | null;
}

export async function getPayment(paymentId: string): Promise<PiPayment> {
  const res = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}`, {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
    signal: piSignal(),
  });
  if (!res.ok) throw new Error(`getPayment failed (${res.status}).`);
  return (await res.json()) as PiPayment;
}

/**
 * Payments this app approved but never completed (user signed, server never
 * called /complete). An unresolved one blocks the user from starting a NEW
 * payment — a common cause of the wallet hanging at "Preparing for a payment".
 */
export async function getIncompleteServerPayments(): Promise<PiPayment[]> {
  const res = await fetch(`${PI_API_BASE}/v2/payments/incomplete_server_payments`, {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
    signal: piSignal(),
  });
  if (!res.ok) throw new Error(`getIncompleteServerPayments failed (${res.status}).`);
  const data = (await res.json()) as { incomplete_server_payments?: PiPayment[] };
  return data.incomplete_server_payments ?? [];
}

export async function approvePayment(paymentId: string): Promise<void> {
  const res = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/approve`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    signal: piSignal(),
  });
  if (!res.ok) throw new Error(`approvePayment failed (${res.status}).`);
}

export async function completePayment(
  paymentId: string,
  txid: string
): Promise<void> {
  const res = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/complete`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ txid }),
    signal: piSignal(),
  });
  if (!res.ok) throw new Error(`completePayment failed (${res.status}).`);
}

export async function cancelPayment(paymentId: string): Promise<void> {
  const res = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/cancel`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    signal: piSignal(),
  });
  if (!res.ok) throw new Error(`cancelPayment failed (${res.status}).`);
}
