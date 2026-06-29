import 'server-only';
import { repo } from './db/repo';
import type { Trade, Payout } from './types';
import {
  completedPayout, refundedPayout, settledPayout, nuclearPayout, microToPi,
} from './escrow';
import {
  payoutsEnabled, createA2U, submitA2U, completeA2U, incompleteA2U, cancelA2U, txidOf,
} from './pi-payout';

const now = () => new Date().toISOString();
const MAX_ATTEMPTS = 5;

/**
 * Which parties are owed what once a trade reaches a funded terminal state.
 * Amounts come straight from the escrow money-math (lib/escrow.ts) so they match
 * the contract/PRD exactly. The 1.5% operator fee is NOT paid out — it stays in
 * the app wallet as revenue. Burned bonds (NUCLEAR) also stay (effectively held).
 */
async function recipientsFor(
  trade: Trade
): Promise<Array<{ role: 'seller' | 'buyer'; uid: string; amountMicro: bigint }>> {
  const amount = BigInt(trade.amount_micro);
  const out: Array<{ role: 'seller' | 'buyer'; uid: string; amountMicro: bigint }> = [];
  const add = (role: 'seller' | 'buyer', uid: string | null, m: bigint) => {
    if (uid && m > 0n) out.push({ role, uid, amountMicro: m });
  };

  if (trade.state === 'COMPLETED') {
    const p = completedPayout(amount, trade.fee_payer);
    add('seller', trade.seller_uid, p.sellerReceives);
    add('buyer', trade.buyer_uid, p.buyerReceives);
  } else if (trade.state === 'REFUNDED') {
    const p = refundedPayout(amount, trade.fee_payer);
    add('buyer', trade.buyer_uid, p.buyerReceives);
    add('seller', trade.seller_uid, p.sellerReceives);
  } else if (trade.state === 'SETTLED') {
    const proposals = await repo().listProposals(trade.id);
    const accepted = proposals.find((p) => p.status === 'accepted');
    const p = settledPayout(amount, BigInt(accepted?.seller_pct ?? 0), trade.fee_payer);
    add('seller', trade.seller_uid, p.sellerReceives);
    add('buyer', trade.buyer_uid, p.buyerReceives);
  } else if (trade.state === 'NUCLEAR') {
    const p = nuclearPayout(amount, trade.fee_payer);
    add('seller', trade.seller_uid, p.sellerReceives);
    add('buyer', trade.buyer_uid, p.buyerReceives);
  }
  return out;
}

/**
 * Record the payouts owed for a just-settled trade as `pending`. Idempotent:
 * id = `${tradeId}:${role}`, so a re-settlement or replay never enqueues twice.
 * Pure DB writes (no chain) — safe to call inside a state transition. The actual
 * on-chain transfer happens later in processPendingPayouts (cron / admin).
 */
export async function enqueuePayoutsForTrade(trade: Trade): Promise<void> {
  if (!payoutsEnabled()) return; // gated until the app wallet seed is configured
  const reason = trade.state.toLowerCase() as Payout['reason'];
  for (const r of await recipientsFor(trade)) {
    const id = `${trade.id}:${r.role}`;
    if (await repo().getPayout(id)) continue; // never double-enqueue
    await repo().addPayout({
      id, trade_id: trade.id, role: r.role, uid: r.uid,
      amount_micro: r.amountMicro.toString(), reason,
      status: 'pending', payment_id: null, txid: null, error: null,
      attempts: 0, created_at: now(), updated_at: now(),
    });
  }
}

/**
 * Resumable create→submit→complete for a single payout, persisting after EACH
 * step. This is what prevents double-paying: if we crash after creating or
 * submitting, the saved payment_id/txid lets the next run resume that exact
 * payment instead of starting a new transfer.
 */
async function advancePayout(p: Payout): Promise<void> {
  if (p.status === 'paid') return;

  if (!p.payment_id) {
    p.payment_id = await createA2U({
      uid: p.uid,
      amountPi: microToPi(BigInt(p.amount_micro)),
      memo: `Clasp ${p.reason} payout`.slice(0, 28),
      metadata: { tradeId: p.trade_id, role: p.role, kind: 'escrow_payout' },
    });
    p.updated_at = now();
    await repo().savePayout(p);
  }
  if (!p.txid) {
    // Guard against double-submit: if a prior attempt already put this payment
    // on-chain (we crashed before saving the txid), adopt that txid rather than
    // submitting a second transfer.
    p.txid = (await txidOf(p.payment_id)) ?? (await submitA2U(p.payment_id));
    p.updated_at = now();
    await repo().savePayout(p);
  }
  await completeA2U(p.payment_id, p.txid);
  p.status = 'paid';
  p.error = null;
  p.updated_at = now();
  await repo().savePayout(p);
  console.log(`[clasp] payout ${p.id} PAID uid=${p.uid} micro=${p.amount_micro} txid=${p.txid}`);
}

/**
 * Drain pending payouts. Processes in-progress ones (those that already hold a
 * payment_id) first to honour Pi's "one incomplete A2U at a time" rule, then
 * fresh ones oldest-first. Stops on the first error so a stuck transfer can't
 * pile up incomplete payments; the cron/admin retries next pass.
 */
export async function processPendingPayouts(
  limit = 20
): Promise<{ processed: number; paid: number; results: Array<{ id: string; status: string; error?: string }> }> {
  if (!payoutsEnabled()) return { processed: 0, paid: 0, results: [] };

  // Safety net: adopt any orphaned in-flight A2U payment Pi knows about but our
  // records don't (e.g. a payment_id write was lost). Cancel/complete handled
  // per-payout below; here we only surface them in logs.
  try {
    const orphans = await incompleteA2U();
    const known = new Set((await repo().listPendingPayouts()).map((p) => p.payment_id));
    for (const o of orphans) {
      if (!known.has(o.identifier)) {
        if (o.txid) await completeA2U(o.identifier, o.txid);
        else await cancelA2U(o.identifier);
        console.warn(`[clasp] payout reconciled orphan A2U ${o.identifier} (${o.txid ? 'completed' : 'cancelled'})`);
      }
    }
  } catch (e) {
    console.error('[clasp] payout orphan-reconcile failed:', e);
  }

  const pending = (await repo().listPendingPayouts())
    .sort((a, b) => (a.payment_id ? 0 : 1) - (b.payment_id ? 0 : 1) || a.created_at.localeCompare(b.created_at))
    .slice(0, limit);

  let paid = 0;
  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const p of pending) {
    try {
      await advancePayout(p);
      if (p.status === 'paid') paid += 1;
      results.push({ id: p.id, status: p.status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      p.attempts += 1;
      p.error = msg;
      if (p.attempts >= MAX_ATTEMPTS) p.status = 'failed';
      p.updated_at = now();
      await repo().savePayout(p);
      results.push({ id: p.id, status: p.status, error: msg });
      console.error(`[clasp] payout ${p.id} attempt ${p.attempts}/${MAX_ATTEMPTS} failed: ${msg}`);
      break; // don't stack incomplete A2U payments
    }
  }
  return { processed: results.length, paid, results };
}
