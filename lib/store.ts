import 'server-only';
import { randomUUID } from 'crypto';
import {
  PARAMS, TradeState, bondFor, feeFor, isTerminal, microToPi,
} from './escrow';
import type {
  Trade, TradeEvent, SettlementProposal, Evidence, AppNotification, Profile,
} from './types';
import { repo } from './db/repo';
import { dispatchWebhook } from './webhooks';

/**
 * Escrow orchestration layer. Loads/persists via the repository (Firestore or
 * in-memory) and applies the state-machine transitions + money math from
 * lib/escrow.ts. This is the only writer of trade state (PRD §7) — it stands in
 * for the chain indexer until the on-chain contract is wired in behind it.
 *
 * Cutover seam: see lib/chain.ts. When NEXT_PUBLIC_CONTRACT_ADDRESS is set, the
 * transitions below become the indexer's reflection of on-chain events rather
 * than the authority; the rules (escrow.ts) are identical to contract/src/lib.rs.
 */

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const plus = (seconds: number, from = now()) => iso(new Date(from.getTime() + seconds * 1000));
const passed = (deadline: string | null) => !!deadline && new Date(deadline).getTime() <= Date.now();

class TransitionError extends Error {}
export function isTransitionError(e: unknown): e is TransitionError {
  return e instanceof TransitionError;
}

async function emit(
  trade: Trade, event: string,
  from: TradeState | null, to: TradeState | null,
  payload: Record<string, unknown> = {}
) {
  const ev: TradeEvent = {
    id: randomUUID(),
    trade_id: trade.id,
    event,
    from_state: from,
    to_state: to,
    chain_tx: payload.txid ? String(payload.txid) : null,
    payload,
    confirmed_at: iso(now()),
  };
  await repo().addEvent(ev);
  await dispatchWebhook(trade, event, payload);
}

async function notify(uid: string | null, trade: Trade, type: string, title: string, body: string) {
  if (!uid) return;
  await repo().addNotification({
    id: randomUUID(), uid, trade_id: trade.id, type, title, body,
    read_at: null, created_at: iso(now()),
  });
}

const ensureProfile = (uid: string, username: string) => repo().upsertUser(uid, username);
const save = (t: Trade) => repo().saveTrade({ ...t, updated_at: iso(now()) });

// ── Public reads ─────────────────────────────────────────────────────────────
export const upsertUser = (uid: string, username: string) => repo().upsertUser(uid, username);
export const getProfile = (uid: string) => repo().getProfile(uid);

/**
 * Public trust stats for a user — the count of successful (completed + settled)
 * trades, shown to counterparties so a buyer can see a seller's track record.
 * Computed from the user's trades so it always reflects real terminal outcomes.
 */
export async function getPublicStats(uid: string) {
  const profile = await repo().getProfile(uid);
  if (!profile) return null;
  const trades = await repo().listTradesForUser(uid);
  let completed = 0;
  let settled = 0;
  let fundedTerminal = 0;
  for (const t of trades) {
    if (t.state === 'COMPLETED') { completed++; fundedTerminal++; }
    else if (t.state === 'SETTLED') { settled++; fundedTerminal++; }
    else if (t.state === 'REFUNDED' || t.state === 'NUCLEAR') { fundedTerminal++; }
  }
  const successful = completed + settled;
  return {
    username: profile.username,
    successful,
    completed,
    settled,
    distinct_counterparties: profile.distinct_counterparties,
    completion_rate: fundedTerminal > 0 ? Math.round((successful / fundedTerminal) * 100) : null,
  };
}
export const getEvents = (tradeId: string) => repo().listEvents(tradeId);
export const getProposals = (tradeId: string) => repo().listProposals(tradeId);
export const getEvidence = (tradeId: string) => repo().listEvidence(tradeId);
export const getNotifications = (uid: string) => repo().listNotifications(uid);
export const markNotificationsRead = (uid: string) => repo().markNotificationsRead(uid);
export const findByIdempotency = (partnerId: string | null, key: string) =>
  repo().getTradeByIdempotency(partnerId, key);

export async function getTrade(id: string): Promise<Trade | null> {
  const t = await repo().getTrade(id);
  if (!t) return null;
  return advanceTimeouts(t);
}
export async function getTradeByRef(partnerId: string | null, ref: string): Promise<Trade | null> {
  const t = await repo().getTradeByRef(partnerId, ref);
  return t ? advanceTimeouts(t) : null;
}
export async function listTradesFor(uid: string): Promise<Trade[]> {
  const list = await repo().listTradesForUser(uid);
  return Promise.all(list.map((t) => advanceTimeouts(t)));
}

// ── Create ───────────────────────────────────────────────────────────────────
export interface CreateArgs {
  sellerUid: string;
  sellerUsername: string;
  amountMicro: bigint;
  shipWindowS: number;
  inspectWindowS: number;
  memo: string;
  partnerId?: string | null;
  ref?: string | null;
  idempotencyKey?: string | null;
}

export async function createTrade(args: CreateArgs): Promise<Trade> {
  await ensureProfile(args.sellerUid, args.sellerUsername);
  const bond = bondFor(args.amountMicro);
  const trade: Trade = {
    id: randomUUID(),
    contract_trade_id: null,
    seller_uid: args.sellerUid,
    seller_username: args.sellerUsername,
    buyer_uid: null,
    buyer_username: null,
    amount_micro: args.amountMicro.toString(),
    buyer_bond_micro: bond.toString(),
    seller_bond_micro: bond.toString(),
    fee_micro: feeFor(args.amountMicro).toString(),
    memo: args.memo,
    ship_window_s: args.shipWindowS,
    inspect_window_s: args.inspectWindowS,
    state: 'CREATED',
    funding_deadline: plus(PARAMS.FUNDING_WINDOW_S),
    ship_deadline: null,
    inspect_deadline: null,
    settlement_deadline: null,
    evidence_hash: null,
    partner_id: args.partnerId ?? null,
    ref: args.ref ?? null,
    idempotency_key: args.idempotencyKey ?? null,
    created_at: iso(now()),
    updated_at: iso(now()),
  };
  await repo().insertTrade(trade);
  await emit(trade, 'trade.created', null, 'CREATED', { amount: microToPi(args.amountMicro) });
  return trade;
}

// ── Transitions ──────────────────────────────────────────────────────────────
async function getOrThrow(id: string): Promise<Trade> {
  const t = await repo().getTrade(id);
  if (!t) throw new TransitionError('Trade not found.');
  return advanceTimeouts(t);
}

export async function fundTrade(id: string, buyerUid: string, buyerUsername: string, txid?: string): Promise<Trade> {
  const t = await getOrThrow(id);
  if (t.state !== 'CREATED') throw new TransitionError('This trade can no longer be funded.');
  if (passed(t.funding_deadline)) throw new TransitionError('The funding window has expired.');
  if (buyerUid === t.seller_uid) throw new TransitionError('You cannot fund your own trade.');
  await ensureProfile(buyerUid, buyerUsername);
  t.buyer_uid = buyerUid;
  t.buyer_username = buyerUsername;
  t.state = 'FUNDED';
  t.ship_deadline = plus(t.ship_window_s);
  await save(t);
  await emit(t, 'trade.funded', 'CREATED', 'FUNDED', { txid, buyer: buyerUsername });
  await notify(t.seller_uid, t, 'funded', 'Funds locked', `${buyerUsername} locked payment. Ship within your window and mark it shipped.`);
  await notify(t.buyer_uid, t, 'funded', 'Payment locked safely', 'Your Pi is held by the contract. The seller cannot touch it until you confirm delivery.');
  return t;
}

export async function markShipped(id: string, sellerUid: string, evidenceHash: string): Promise<Trade> {
  const t = await getOrThrow(id);
  if (t.state !== 'FUNDED') throw new TransitionError('Only a funded trade can be marked shipped.');
  if (sellerUid !== t.seller_uid) throw new TransitionError('Only the seller can mark a trade shipped.');
  if (passed(t.ship_deadline)) throw new TransitionError('The ship window has expired.');
  if (!evidenceHash) throw new TransitionError('Shipping evidence is required.');
  t.state = 'SHIPPED';
  t.evidence_hash = evidenceHash;
  t.inspect_deadline = plus(t.inspect_window_s);
  await save(t);
  await emit(t, 'trade.shipped', 'FUNDED', 'SHIPPED', { evidence_hash: evidenceHash });
  await notify(t.buyer_uid, t, 'shipped', 'Seller marked shipped', 'Check your delivery, then confirm receipt to release payment — or open a dispute before the window ends.');
  return t;
}

export async function confirmReceipt(id: string, buyerUid: string): Promise<Trade> {
  const t = await getOrThrow(id);
  if (t.state !== 'SHIPPED') throw new TransitionError('Only a shipped trade can be confirmed.');
  if (buyerUid !== t.buyer_uid) throw new TransitionError('Only the buyer can confirm receipt.');
  await complete(t, 'manual');
  return t;
}

export async function openDispute(id: string, buyerUid: string): Promise<Trade> {
  const t = await getOrThrow(id);
  if (t.state !== 'SHIPPED') throw new TransitionError('Only a shipped trade can be disputed.');
  if (buyerUid !== t.buyer_uid) throw new TransitionError('Only the buyer can open a dispute.');
  if (passed(t.inspect_deadline)) throw new TransitionError('The inspection window has closed.');
  t.state = 'DISPUTED';
  t.settlement_deadline = plus(PARAMS.SETTLEMENT_WINDOW_S);
  await save(t);
  const sp = await repo().getProfile(t.seller_uid);
  if (sp) { sp.disputes_total += 1; await repo().saveProfile(sp); }
  await emit(t, 'trade.disputed', 'SHIPPED', 'DISPUTED', {});
  await notify(t.seller_uid, t, 'disputed', 'Dispute opened', 'Propose a fair split. If neither side settles in 7 days, both bonds burn — settlement is the only rational outcome.');
  await notify(t.buyer_uid, t, 'disputed', 'Dispute opened', 'Negotiate a split with the seller. Settling beats the nuclear outcome for both of you.');
  return t;
}

export async function proposeSettlement(id: string, proposerUid: string, sellerPct: number): Promise<{ trade: Trade; proposal: SettlementProposal }> {
  const t = await getOrThrow(id);
  if (t.state !== 'DISPUTED') throw new TransitionError('Settlement proposals are only valid during a dispute.');
  if (proposerUid !== t.seller_uid && proposerUid !== t.buyer_uid) throw new TransitionError('Only a party to the trade can propose.');
  if (passed(t.settlement_deadline)) throw new TransitionError('The settlement window has closed.');
  if (sellerPct < 0 || sellerPct > 100 || sellerPct % Number(PARAMS.SETTLEMENT_STEP_PCT) !== 0)
    throw new TransitionError('Proposals must be in 5% increments.');

  const existing = await repo().listProposals(id);
  for (const p of existing) if (p.status === 'open') await repo().saveProposal({ ...p, status: 'superseded' });

  const proposal: SettlementProposal = {
    id: randomUUID(), trade_id: id, proposer_uid: proposerUid, seller_pct: sellerPct,
    status: 'open', created_at: iso(now()),
  };
  await repo().addProposal(proposal);
  await emit(t, 'trade.settlement_proposed', 'DISPUTED', 'DISPUTED', { seller_pct: sellerPct, proposer: proposerUid });
  const other = proposerUid === t.seller_uid ? t.buyer_uid : t.seller_uid;
  await notify(other, t, 'settlement_proposed', 'New settlement offer', `A split of ${sellerPct}% to the seller was proposed. Accept it or counter.`);
  return { trade: t, proposal };
}

export async function acceptSettlement(id: string, accepterUid: string, proposalId: string): Promise<Trade> {
  const t = await getOrThrow(id);
  if (t.state !== 'DISPUTED') throw new TransitionError('Nothing to accept — the trade is not in dispute.');
  const proposals = await repo().listProposals(id);
  const proposal = proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== 'open') throw new TransitionError('That proposal is no longer open.');
  if (accepterUid === proposal.proposer_uid) throw new TransitionError('The counterparty must accept, not the proposer.');
  if (accepterUid !== t.seller_uid && accepterUid !== t.buyer_uid) throw new TransitionError('Only a party to the trade can accept.');
  await repo().saveProposal({ ...proposal, status: 'accepted' });
  t.state = 'SETTLED';
  await save(t);
  await emit(t, 'trade.settled', 'DISPUTED', 'SETTLED', { seller_pct: proposal.seller_pct });
  await notify(t.seller_uid, t, 'settled', 'Dispute settled', `Agreed split: ${proposal.seller_pct}% to seller. Funds released by the contract.`);
  await notify(t.buyer_uid, t, 'settled', 'Dispute settled', `Agreed split: ${100 - proposal.seller_pct}% refunded to you. Bonds returned.`);
  return t;
}

export async function cancelUnfunded(id: string, byUid: string): Promise<Trade> {
  const t = await getOrThrow(id);
  if (t.state !== 'CREATED') throw new TransitionError('Only an unfunded trade can be cancelled.');
  const sellerCancel = byUid === t.seller_uid;
  if (!sellerCancel && !passed(t.funding_deadline))
    throw new TransitionError('Only the seller can cancel before the funding window expires.');
  t.state = 'CANCELLED';
  await save(t);
  await emit(t, 'trade.cancelled', 'CREATED', 'CANCELLED', { by: sellerCancel ? 'seller' : 'timeout' });
  await notify(t.seller_uid, t, 'cancelled', 'Trade cancelled', 'The trade was cancelled and your seller bond returned.');
  return t;
}

export async function claimTimeout(id: string): Promise<Trade> {
  return getOrThrow(id);
}

/** Buyer or seller attaches dispute evidence (image path or note). */
export async function addEvidence(id: string, uploaderUid: string, storagePath: string, caption: string | null): Promise<Evidence> {
  const t = await getOrThrow(id);
  if (uploaderUid !== t.seller_uid && uploaderUid !== t.buyer_uid)
    throw new TransitionError('Only a party to the trade can add evidence.');
  if (t.state !== 'DISPUTED' && t.state !== 'SHIPPED')
    throw new TransitionError('Evidence can only be added while shipped or in dispute.');
  const ev: Evidence = {
    id: randomUUID(), trade_id: id, uploader_uid: uploaderUid, storage_path: storagePath,
    caption, created_at: iso(now()),
  };
  await repo().addEvidence(ev);
  return ev;
}

// ── Internal ─────────────────────────────────────────────────────────────────
async function complete(t: Trade, reason: 'manual' | 'silence') {
  t.state = 'COMPLETED';
  await save(t);
  await emit(t, 'trade.completed', 'SHIPPED', 'COMPLETED', { reason });
  await bumpCompletion(t);
  await notify(t.seller_uid, t, 'completed', 'Trade complete — you got paid', reason === 'silence'
    ? 'The inspection window passed with no dispute. Payment released to you, minus the 1.5% fee.'
    : 'The buyer confirmed delivery. Payment released to you, minus the 1.5% fee.');
  await notify(t.buyer_uid, t, 'completed', 'Trade complete', 'Your bond was returned. Thanks for trading safely on Clasp.');
}

async function bumpCompletion(t: Trade) {
  for (const uid of [t.seller_uid, t.buyer_uid]) {
    if (!uid) continue;
    const p = await repo().getProfile(uid);
    if (p) { p.trades_total += 1; p.trades_completed += 1; await repo().saveProfile(p); }
    await recountCounterparties(uid);
  }
}

async function recountCounterparties(uid: string) {
  const p = await repo().getProfile(uid);
  if (!p) return;
  const trades = await repo().listTradesForUser(uid);
  const set = new Set<string>();
  for (const t of trades) {
    if (!isTerminal(t.state)) continue;
    const other = t.seller_uid === uid ? t.buyer_uid : t.seller_uid;
    if (other) set.add(other);
  }
  p.distinct_counterparties = set.size;
  await repo().saveProfile(p);
}

/** Apply any due permissionless timeout transition. May persist + emit. */
async function advanceTimeouts(t: Trade): Promise<Trade> {
  if (isTerminal(t.state)) return t;

  if (t.state === 'CREATED' && passed(t.funding_deadline)) {
    t.state = 'CANCELLED';
    await save(t);
    await emit(t, 'trade.cancelled', 'CREATED', 'CANCELLED', { by: 'timeout' });
    await notify(t.seller_uid, t, 'cancelled', 'Trade expired unfunded', 'No buyer funded in time. Your seller bond was returned.');
    return t;
  }
  if (t.state === 'FUNDED' && passed(t.ship_deadline)) {
    t.state = 'REFUNDED';
    await save(t);
    await emit(t, 'trade.refunded', 'FUNDED', 'REFUNDED', { by: 'timeout' });
    await notify(t.buyer_uid, t, 'refunded', 'Auto-refunded — seller no-show', 'The seller missed the ship window. Your payment and bond were returned in full.');
    await notify(t.seller_uid, t, 'refunded', 'Trade refunded', 'You missed the ship window, so the buyer was refunded. Your seller bond was returned.');
    return t;
  }
  if (t.state === 'SHIPPED' && passed(t.inspect_deadline)) {
    await complete(t, 'silence');
    return t;
  }
  if (t.state === 'DISPUTED' && passed(t.settlement_deadline)) {
    t.state = 'NUCLEAR';
    await save(t);
    await emit(t, 'trade.nuclear', 'DISPUTED', 'NUCLEAR', {});
    await notify(t.seller_uid, t, 'nuclear', 'Nuclear outcome', 'No settlement was reached. Both bonds were burned and the principal split 50/50.');
    await notify(t.buyer_uid, t, 'nuclear', 'Nuclear outcome', 'No settlement was reached. Both bonds were burned and the principal split 50/50.');
    return t;
  }
  return t;
}

/** Deadline-reminder cron source (PRD §11). */
export const tradesNeedingReminder = () => repo().listActiveTrades();

/** Seed demo trades for a fresh local-preview (sandbox) user. Real Pi users
 *  start empty — the auth route only calls this for `sandbox_…` identities. */
export async function seedDemo(uid: string, username: string) {
  const existing = await repo().listTradesForUser(uid);
  if (existing.length > 0) return;
  await ensureProfile(uid, username);
  const P = PARAMS.AMOUNT_FLOOR;

  await createTrade({
    sellerUid: uid, sellerUsername: username,
    amountMicro: P * 8n, shipWindowS: PARAMS.SHIP_DEFAULT_S, inspectWindowS: PARAMS.INSPECT_DEFAULT_S,
    memo: 'Custom phone case, matte black',
  });

  const t2 = await createTrade({
    sellerUid: 'pi_demo_chidi', sellerUsername: 'chidi_makes',
    amountMicro: P * 12n, shipWindowS: PARAMS.SHIP_DEFAULT_S, inspectWindowS: PARAMS.INSPECT_DEFAULT_S,
    memo: 'Hand-woven Aso-Oke fabric, 2 yards',
  });
  await fundTrade(t2.id, uid, username, 'demo-tx-2');

  const t3 = await createTrade({
    sellerUid: 'pi_demo_amaka', sellerUsername: 'amaka_store',
    amountMicro: P * 20n, shipWindowS: PARAMS.SHIP_DEFAULT_S, inspectWindowS: PARAMS.INSPECT_DEFAULT_S,
    memo: 'Bluetooth speaker, brand new',
  });
  await fundTrade(t3.id, uid, username, 'demo-tx-3');
  await markShipped(t3.id, 'pi_demo_amaka', 'demo-evidence-hash');
  await openDispute(t3.id, uid);
  await proposeSettlement(t3.id, 'pi_demo_amaka', 70);

  const t4 = await createTrade({
    sellerUid: uid, sellerUsername: username,
    amountMicro: P * 6n, shipWindowS: PARAMS.SHIP_DEFAULT_S, inspectWindowS: PARAMS.INSPECT_DEFAULT_S,
    memo: 'Beaded necklace set',
  });
  await fundTrade(t4.id, 'pi_demo_ngozi', 'ngozi_buys', 'demo-tx-4');
  await markShipped(t4.id, uid, 'demo-evidence-4');
  await confirmReceipt(t4.id, 'pi_demo_ngozi');
}

// Re-export Profile for convenience
export type { Profile };
