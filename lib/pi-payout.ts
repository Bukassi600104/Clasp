import 'server-only';
import PiNetwork from 'pi-backend';

/**
 * App-to-User (A2U) payout bridge — the custodial settlement leg of the escrow.
 *
 * Funds that buyers lock arrive in the app's Pi wallet (U2A `Pi.createPayment`).
 * When a trade settles, the app sends Pi back out to the seller and/or buyer via
 * the official `pi-backend` SDK, which builds + signs + submits the on-chain
 * transfer from the app wallet (PI_WALLET_PRIVATE_SEED) and acknowledges it.
 *
 * GATED: returns "not enabled" unless BOTH PI_API_KEY and PI_WALLET_PRIVATE_SEED
 * are set — so until the wallet seed is configured the app behaves exactly as
 * before (no payouts), and nothing here can move funds by accident.
 *
 * Pi allows only ONE incomplete A2U payment per app at a time, so callers must
 * resolve any in-flight payment before creating a new one (see lib/payouts.ts).
 */

const API_KEY = process.env.PI_API_KEY;
const WALLET_SEED = process.env.PI_WALLET_PRIVATE_SEED;

export function payoutsEnabled(): boolean {
  return !!API_KEY && !!WALLET_SEED;
}

let _pi: PiNetwork | null = null;
function pi(): PiNetwork {
  if (!API_KEY || !WALLET_SEED) {
    throw new Error('Payouts not configured (PI_API_KEY / PI_WALLET_PRIVATE_SEED missing).');
  }
  if (!_pi) _pi = new PiNetwork(API_KEY, WALLET_SEED);
  return _pi;
}

export interface A2UArgs {
  uid: string;
  amountPi: number;
  memo: string;
  metadata: Record<string, unknown>;
}

/** Phase 1 — create the A2U payment record on Pi. Returns the paymentId. */
export function createA2U(args: A2UArgs): Promise<string> {
  return pi().createPayment({
    amount: args.amountPi,
    memo: args.memo,
    metadata: args.metadata,
    uid: args.uid,
  });
}

/** Phase 2 — sign + submit the blockchain transfer from the app wallet. Returns txid. */
export function submitA2U(paymentId: string): Promise<string> {
  return pi().submitPayment(paymentId);
}

/** Read a payment's current on-chain state. Used before (re)submitting so a retry
 *  that crashed after submit adopts the existing txid instead of paying twice. */
export async function txidOf(paymentId: string): Promise<string | null> {
  const p = await pi().getPayment(paymentId);
  return p.transaction?.txid ?? null;
}

/** Phase 3 — acknowledge completion with Pi. */
export async function completeA2U(paymentId: string, txid: string): Promise<void> {
  await pi().completePayment(paymentId, txid);
}

/** Any A2U payment this app started but never finished (max one at a time). */
export async function incompleteA2U(): Promise<
  Array<{ identifier: string; txid: string | null }>
> {
  const list = (await pi().getIncompleteServerPayments()) ?? [];
  return list.map((p) => ({ identifier: p.identifier, txid: p.transaction?.txid ?? null }));
}

export async function cancelA2U(paymentId: string): Promise<void> {
  await pi().cancelPayment(paymentId);
}
