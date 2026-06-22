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
  });
  if (!res.ok) throw new Error(`getPayment failed (${res.status}).`);
  return (await res.json()) as PiPayment;
}

export async function approvePayment(paymentId: string): Promise<void> {
  const res = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/approve`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
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
  });
  if (!res.ok) throw new Error(`completePayment failed (${res.status}).`);
}

export async function cancelPayment(paymentId: string): Promise<void> {
  const res = await fetch(`${PI_API_BASE}/v2/payments/${paymentId}/cancel`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) throw new Error(`cancelPayment failed (${res.status}).`);
}
