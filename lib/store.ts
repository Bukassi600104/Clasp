import 'server-only';
import { randomUUID } from 'crypto';
import {
  PARAMS, TradeState, bondFor, feeFor, isTerminal, microToPi,
} from './escrow';
import {
  DEFAULT_LIMIT_MICRO, tierFor, effectiveLimitMicro, clampChosenLimit,
} from './tiers';
import type {
  Trade, TradeEvent, SettlementProposal, Evidence, AppNotification, Profile,
  Rating, RatingSummary,
} from './types';
import { repo } from './db/repo';
import type { TransitionResult } from './db/repo';
import { TransitionError } from './errors';
import { dispatchWebhook } from './webhooks';
import { enqueuePayoutsForTrade, kickPayouts } from './payouts';

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

// Domain error lives in lib/errors.ts so the repo layer can throw it without a
// circular import; re-exported here so existing importers keep working.
export { TransitionError, isTransitionError } from './errors';

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

function ratingSummary(pos = 0, count = 0): RatingSummary {
  return { positivePct: count > 0 ? Math.round((pos / count) * 100) : null, count };
}

/** A seller's chosen per-trade cap. undefined (legacy) → Starter default;
 *  null → unlimited (Elite); string → that value. */
function chosenLimitMicro(p: Profile): bigint | null {
  const v = p.trade_limit_micro;
  if (v === undefined) return DEFAULT_LIMIT_MICRO;
  if (v === null) return null;
  return BigInt(v);
}

/** Clean (never-disputed) completed trades where the user was the seller. */
function sellerQualifying(trades: Trade[], uid: string): number {
  return trades.filter((t) => t.seller_uid === uid && t.state === 'COMPLETED').length;
}

/**
 * Public trust stats for a user — successful (completed + settled) trade count,
 * completion rate, earned tier, and mutual ratings — shown to counterparties so
 * a buyer can gauge a seller's track record (and vice versa). Always computed
 * from real terminal outcomes so it can't be faked.
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
  const qualifying = sellerQualifying(trades, uid);
  const tier = tierFor(qualifying);
  return {
    username: profile.username,
    successful,
    completed,
    settled,
    distinct_counterparties: profile.distinct_counterparties,
    completion_rate: fundedTerminal > 0 ? Math.round((successful / fundedTerminal) * 100) : null,
    qualifying,
    tier: {
      id: tier.id, name: tier.name, tone: tier.tone,
      ceiling_micro: tier.ceilingMicro === null ? null : tier.ceilingMicro.toString(),
    },
    seller_rating: ratingSummary(profile.seller_pos_count, profile.seller_rating_count),
    buyer_rating: ratingSummary(profile.buyer_pos_count, profile.buyer_rating_count),
  };
}

/** Seller's qualifying count + effective per-trade cap — for create-time
 *  enforcement and for the create screen to show the right ceiling. */
export async function sellerLimitInfo(uid: string): Promise<{ qualifying: number; effectiveMicro: bigint | null }> {
  const [trades, profile] = await Promise.all([
    repo().listTradesForUser(uid),
    repo().getProfile(uid),
  ]);
  const qualifying = sellerQualifying(trades, uid);
  const chosen = profile ? chosenLimitMicro(profile) : DEFAULT_LIMIT_MICRO;
  return { qualifying, effectiveMicro: effectiveLimitMicro(qualifying, chosen) };
}

/** Seller raises/lowers their per-trade cap (clamped to the earned ceiling). */
export async function setSellerLimit(uid: string, pi: number | null): Promise<Profile> {
  const [profile, trades] = await Promise.all([
    repo().getProfile(uid),
    repo().listTradesForUser(uid),
  ]);
  if (!profile) throw new TransitionError('Profile not found.');
  const qualifying = sellerQualifying(trades, uid);
  const clamped = clampChosenLimit(qualifying, pi);
  profile.trade_limit_micro = clamped === null ? null : clamped.toString();
  await repo().saveProfile(profile);
  return profile;
}

/** Full self-view for the profile screen: stats, chosen + effective cap, reviews. */
export async function getOwnProfileView(uid: string) {
  const [stats, profile, reviews] = await Promise.all([
    getPublicStats(uid),
    repo().getProfile(uid),
    repo().listRatingsAbout(uid),
  ]);
  if (!stats || !profile) return null;
  const chosen = chosenLimitMicro(profile);
  const effective = effectiveLimitMicro(stats.qualifying, chosen);
  return {
    stats,
    chosen_limit_micro: chosen === null ? null : chosen.toString(),
    effective_limit_micro: effective === null ? null : effective.toString(),
    reviews: reviews.slice(0, 12),
  };
}

/**
 * Mutual rating — after a funded trade reaches a terminal outcome, each party
 * may rate the other once (1–5 stars + optional comment). Aggregates land on the
 * ratee's profile, split by the role they played (seller vs buyer reputation).
 */
export async function rateCounterparty(
  tradeId: string, raterUid: string, raterUsername: string | null,
  positive: boolean, comment: string | null,
): Promise<Rating> {
  const t = await getOrThrow(tradeId);
  if (raterUid !== t.seller_uid && raterUid !== t.buyer_uid)
    throw new TransitionError('Only a party to the trade can rate it.');
  if (!t.buyer_uid) throw new TransitionError('This trade had no counterparty to rate.');
  if (!isTerminal(t.state)) throw new TransitionError('You can rate once the trade is complete.');
  if (typeof positive !== 'boolean') throw new TransitionError('Feedback must be positive or negative.');
  const existing = await repo().getRatingByRater(tradeId, raterUid);
  if (existing) throw new TransitionError('You already rated this trade.');

  const rateeUid = raterUid === t.seller_uid ? t.buyer_uid : t.seller_uid;
  const rateeRole: 'seller' | 'buyer' = rateeUid === t.seller_uid ? 'seller' : 'buyer';
  const clean = comment && comment.trim() ? comment.trim().slice(0, 280) : null;
  const rating: Rating = {
    id: randomUUID(), trade_id: tradeId, rater_uid: raterUid, rater_username: raterUsername,
    ratee_uid: rateeUid, ratee_role: rateeRole, positive, comment: clean, created_at: iso(now()),
  };
  await repo().addRating(rating);

  const rp = await repo().getProfile(rateeUid);
  if (rp) {
    if (rateeRole === 'seller') {
      rp.seller_pos_count = (rp.seller_pos_count ?? 0) + (positive ? 1 : 0);
      rp.seller_rating_count = (rp.seller_rating_count ?? 0) + 1;
    } else {
      rp.buyer_pos_count = (rp.buyer_pos_count ?? 0) + (positive ? 1 : 0);
      rp.buyer_rating_count = (rp.buyer_rating_count ?? 0) + 1;
    }
    await repo().saveProfile(rp);
  }
  await notify(rateeUid, t, 'rated', 'You received feedback',
    `${raterUsername ?? 'Your counterparty'} left ${positive ? '👍 positive' : '👎 negative'} feedback${clean ? ` — “${clean}”` : ''}.`);
  return rating;
}

export const getRatingsForTrade = (tradeId: string) => repo().listRatingsForTrade(tradeId);
export const getRatingsAbout = (uid: string) => repo().listRatingsAbout(uid);
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
  feePayer?: 'seller' | 'buyer';
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
    fee_payer: args.feePayer ?? 'seller',
    seller_bond_paid: false,
    seller_bond_txid: null,
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

/**
 * Mark a trade's seller security bond as posted (paid via Pi at creation, bound
 * to its on-chain txid). Until this is set, the trade cannot be funded. Idempotent
 * and seller-only; the bond amount is validated against the payment in the
 * approve route before this runs.
 */
export async function bondTrade(id: string, sellerUid: string, txid?: string): Promise<Trade> {
  await advanceTimeoutsById(id);
  let replay = false;
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (sellerUid !== fresh.seller_uid) throw new TransitionError('Only the seller can post the seller bond.');
    if (fresh.seller_bond_paid) { replay = true; return { trade: fresh, unchanged: true }; }
    if (fresh.state !== 'CREATED') throw new TransitionError('This trade is past the bond stage.');
    fresh.seller_bond_paid = true;
    fresh.seller_bond_txid = txid ?? null;
    fresh.updated_at = iso(now());
    return {
      trade: fresh,
      history: { event: 'trade.bonded', from: 'CREATED', to: 'CREATED', actor: sellerUid, payload: { txid: txid ?? null } },
    };
  });
  if (!replay) await emit(t, 'trade.bonded', 'CREATED', 'CREATED', { txid, by: 'seller' });
  return t;
}

// ── Transitions ──────────────────────────────────────────────────────────────
//
// Every state change runs inside repo().runTradeTransition: the guards execute
// against the trade as read INSIDE the store's transaction, and the new state
// commits together with its state_history row — or not at all. Notifications,
// trade_events and webhooks are append-only side effects and run after commit.

async function getOrThrow(id: string): Promise<Trade> {
  const t = await repo().getTrade(id);
  if (!t) throw new TransitionError('Trade not found.');
  return advanceTimeouts(t);
}

export async function fundTrade(id: string, buyerUid: string, buyerUsername: string, txid?: string): Promise<Trade> {
  await advanceTimeoutsById(id);
  await ensureProfile(buyerUid, buyerUsername);
  let replay = false;
  const t = await repo().runTradeTransition(id, (fresh) => {
    // Idempotent replay: Pi (or the client) can re-send completion for the same
    // payment. If this buyer already funded it, return the recorded trade instead
    // of throwing — a successful retry must never look like a failure or lose data.
    if (fresh.state === 'FUNDED' && fresh.buyer_uid === buyerUid) { replay = true; return { trade: fresh, unchanged: true }; }
    if (fresh.state !== 'CREATED') throw new TransitionError('This trade can no longer be funded.');
    if (passed(fresh.funding_deadline)) throw new TransitionError('The funding window has expired.');
    if (buyerUid === fresh.seller_uid) throw new TransitionError('You cannot fund your own trade.');
    if (fresh.seller_bond_paid === false) throw new TransitionError('The seller has not posted their security bond yet.');
    fresh.buyer_uid = buyerUid;
    fresh.buyer_username = buyerUsername;
    fresh.state = 'FUNDED';
    fresh.ship_deadline = plus(fresh.ship_window_s);
    fresh.updated_at = iso(now());
    return {
      trade: fresh,
      history: { event: 'trade.funded', from: 'CREATED', to: 'FUNDED', actor: buyerUid, payload: { txid: txid ?? null } },
    };
  });
  if (!replay) {
    await emit(t, 'trade.funded', 'CREATED', 'FUNDED', { txid, buyer: buyerUsername });
    await notify(t.seller_uid, t, 'funded', 'Funds locked', `${buyerUsername} locked payment. Ship within your window and mark it shipped.`);
    await notify(t.buyer_uid, t, 'funded', 'Payment locked safely', 'Your Pi is held by the contract. The seller cannot touch it until you confirm delivery.');
  }
  return t;
}

export async function markShipped(id: string, sellerUid: string, evidenceHash: string): Promise<Trade> {
  await advanceTimeoutsById(id);
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (fresh.state !== 'FUNDED') throw new TransitionError('Only a funded trade can be marked shipped.');
    if (sellerUid !== fresh.seller_uid) throw new TransitionError('Only the seller can mark a trade shipped.');
    if (passed(fresh.ship_deadline)) throw new TransitionError('The ship window has expired.');
    if (!evidenceHash) throw new TransitionError('Shipping evidence is required.');
    fresh.state = 'SHIPPED';
    fresh.evidence_hash = evidenceHash;
    fresh.inspect_deadline = plus(fresh.inspect_window_s);
    fresh.updated_at = iso(now());
    return {
      trade: fresh,
      history: { event: 'trade.shipped', from: 'FUNDED', to: 'SHIPPED', actor: sellerUid, payload: { evidence_hash: evidenceHash } },
    };
  });
  await emit(t, 'trade.shipped', 'FUNDED', 'SHIPPED', { evidence_hash: evidenceHash });
  await notify(t.buyer_uid, t, 'shipped', 'Seller marked shipped', 'Check your delivery, then confirm receipt to release payment — or open a dispute before the window ends.');
  return t;
}

export async function confirmReceipt(id: string, buyerUid: string): Promise<Trade> {
  await advanceTimeoutsById(id);
  return completeTrade(id, buyerUid, 'manual');
}

export async function openDispute(id: string, buyerUid: string): Promise<Trade> {
  await advanceTimeoutsById(id);
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (fresh.state !== 'SHIPPED') throw new TransitionError('Only a shipped trade can be disputed.');
    if (buyerUid !== fresh.buyer_uid) throw new TransitionError('Only the buyer can open a dispute.');
    if (passed(fresh.inspect_deadline)) throw new TransitionError('The inspection window has closed.');
    fresh.state = 'DISPUTED';
    fresh.disputed = true; // permanently excludes this trade from the seller's clean count
    fresh.settlement_deadline = plus(PARAMS.SETTLEMENT_WINDOW_S);
    fresh.updated_at = iso(now());
    return {
      trade: fresh,
      history: { event: 'trade.disputed', from: 'SHIPPED', to: 'DISPUTED', actor: buyerUid },
    };
  });
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
  await advanceTimeoutsById(id);
  // The proposal is read before the transaction (mutators must be synchronous);
  // the trade-state guard re-runs inside it, so a racing accept or timeout makes
  // the second writer fail cleanly rather than double-settle.
  const proposals = await repo().listProposals(id);
  const proposal = proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== 'open') throw new TransitionError('That proposal is no longer open.');
  if (accepterUid === proposal.proposer_uid) throw new TransitionError('The counterparty must accept, not the proposer.');
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (fresh.state !== 'DISPUTED') throw new TransitionError('Nothing to accept — the trade is not in dispute.');
    if (accepterUid !== fresh.seller_uid && accepterUid !== fresh.buyer_uid) throw new TransitionError('Only a party to the trade can accept.');
    fresh.state = 'SETTLED';
    fresh.updated_at = iso(now());
    return {
      trade: fresh,
      history: { event: 'trade.settled', from: 'DISPUTED', to: 'SETTLED', actor: accepterUid, payload: { seller_pct: proposal.seller_pct, proposal_id: proposal.id } },
    };
  });
  await repo().saveProposal({ ...proposal, status: 'accepted' });
  await enqueuePayoutsForTrade(t); // split per the accepted proposal + bonds back
  kickPayouts();
  await emit(t, 'trade.settled', 'DISPUTED', 'SETTLED', { seller_pct: proposal.seller_pct });
  await notify(t.seller_uid, t, 'settled', 'Dispute settled', `Agreed split: ${proposal.seller_pct}% to seller. Funds released by the contract.`);
  await notify(t.buyer_uid, t, 'settled', 'Dispute settled', `Agreed split: ${100 - proposal.seller_pct}% refunded to you. Bonds returned.`);
  return t;
}

export async function cancelUnfunded(id: string, byUid: string): Promise<Trade> {
  await advanceTimeoutsById(id);
  let sellerCancel = false;
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (fresh.state !== 'CREATED') throw new TransitionError('Only an unfunded trade can be cancelled.');
    sellerCancel = byUid === fresh.seller_uid;
    if (!sellerCancel && !passed(fresh.funding_deadline))
      throw new TransitionError('Only the seller can cancel before the funding window expires.');
    fresh.state = 'CANCELLED';
    fresh.updated_at = iso(now());
    return {
      trade: fresh,
      history: { event: 'trade.cancelled', from: 'CREATED', to: 'CANCELLED', actor: sellerCancel ? byUid : 'timeout' },
    };
  });
  await emit(t, 'trade.cancelled', 'CREATED', 'CANCELLED', { by: sellerCancel ? 'seller' : 'timeout' });
  await notify(t.seller_uid, t, 'cancelled', 'Trade cancelled', 'The trade was cancelled and your seller bond returned.');
  return t;
}

export async function claimTimeout(id: string): Promise<Trade> {
  return getOrThrow(id);
}

/**
 * Reactivate a trade that expired (funding window passed → auto-CANCELLED) or
 * was cancelled before it was ever funded — instead of recreating it from
 * scratch. Only the seller (the owner) may do this, only while CANCELLED and
 * only if it was never funded (no buyer attached). Resets it to CREATED with a
 * fresh funding window so the same link works again.
 *
 * SECURITY: never reactivate a trade that reached a *funded* terminal outcome
 * (REFUNDED/NUCLEAR/COMPLETED/SETTLED) — those moved real value; the guard below
 * only admits CANCELLED + no buyer, so funds can't be replayed.
 */
export async function reactivateTrade(id: string, byUid: string): Promise<Trade> {
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (fresh.state !== 'CANCELLED')
      throw new TransitionError('Only a cancelled or expired trade can be reactivated.');
    if (fresh.buyer_uid)
      throw new TransitionError('A trade that was already funded cannot be reactivated.');
    if (byUid !== fresh.seller_uid)
      throw new TransitionError('Only the seller can reactivate their trade.');
    fresh.state = 'CREATED';
    fresh.funding_deadline = plus(PARAMS.FUNDING_WINDOW_S);
    fresh.updated_at = iso(now());
    return {
      trade: fresh,
      history: { event: 'trade.reactivated', from: 'CANCELLED', to: 'CREATED', actor: byUid },
    };
  });
  await emit(t, 'trade.reactivated', 'CANCELLED', 'CREATED', { by: 'seller' });
  await notify(t.seller_uid, t, 'reactivated', 'Trade reactivated',
    'Your trade is live again with a fresh 24h funding window. Share the link to get paid.');
  return t;
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

/**
 * SHIPPED → COMPLETED, transactional. `reason:'manual'` is the buyer confirming
 * (actor must be the buyer); `reason:'silence'` is the permissionless inspection
 * timeout (actor recorded as 'timeout'). The silence path is a no-op instead of
 * an error when another writer got there first, since lazy timeouts race reads.
 */
async function completeTrade(id: string, actor: string | null, reason: 'manual' | 'silence'): Promise<Trade> {
  let noop = false;
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (reason === 'silence') {
      if (fresh.state !== 'SHIPPED' || !passed(fresh.inspect_deadline)) {
        noop = true;
        return { trade: fresh, unchanged: true };
      }
    } else {
      if (fresh.state !== 'SHIPPED') throw new TransitionError('Only a shipped trade can be confirmed.');
      if (actor !== fresh.buyer_uid) throw new TransitionError('Only the buyer can confirm receipt.');
    }
    fresh.state = 'COMPLETED';
    fresh.updated_at = iso(now());
    return {
      trade: fresh,
      history: { event: 'trade.completed', from: 'SHIPPED', to: 'COMPLETED', actor: reason === 'manual' ? actor : 'timeout', payload: { reason } },
    };
  });
  if (noop) return t;
  await enqueuePayoutsForTrade(t); // owe seller price + bond, buyer bond
  kickPayouts();
  await emit(t, 'trade.completed', 'SHIPPED', 'COMPLETED', { reason });
  await bumpCompletion(t);
  await notify(t.seller_uid, t, 'completed', 'Trade complete — you got paid', reason === 'silence'
    ? 'The inspection window passed with no dispute. The full price plus your bond are on the way to you.'
    : 'The buyer confirmed delivery. The full price plus your bond are on the way to you.');
  await notify(t.buyer_uid, t, 'completed', 'Trade complete', 'Your bond was returned. Thanks for trading safely on Clasp.');
  return t;
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

/**
 * Apply any due permissionless timeout transition, transactionally. The snapshot
 * only decides WHICH timeout might be due; the deadline + state are re-checked
 * inside the transaction, and a concurrent writer turns the timeout into a
 * silent no-op instead of clobbering their transition.
 */
async function advanceTimeouts(t: Trade): Promise<Trade> {
  if (isTerminal(t.state)) return t;
  if (t.state === 'CREATED' && passed(t.funding_deadline)) return timeoutCancel(t.id);
  if (t.state === 'FUNDED' && passed(t.ship_deadline)) return timeoutRefund(t.id);
  if (t.state === 'SHIPPED' && passed(t.inspect_deadline)) return completeTrade(t.id, null, 'silence');
  if (t.state === 'DISPUTED' && passed(t.settlement_deadline)) return timeoutNuclear(t.id);
  return t;
}

/** Run due timeouts for a trade by id before an explicit transition attempts its
 *  own guards — so "expired" trades fail with the right message, atomically. */
async function advanceTimeoutsById(id: string): Promise<void> {
  const t = await repo().getTrade(id);
  if (t) await advanceTimeouts(t);
}

async function timeoutCancel(id: string): Promise<Trade> {
  let noop = false;
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (fresh.state !== 'CREATED' || !passed(fresh.funding_deadline)) {
      noop = true;
      return { trade: fresh, unchanged: true };
    }
    fresh.state = 'CANCELLED';
    fresh.updated_at = iso(now());
    return { trade: fresh, history: { event: 'trade.cancelled', from: 'CREATED', to: 'CANCELLED', actor: 'timeout' } };
  });
  if (noop) return t;
  await emit(t, 'trade.cancelled', 'CREATED', 'CANCELLED', { by: 'timeout' });
  await notify(t.seller_uid, t, 'cancelled', 'Trade expired unfunded', 'No buyer funded in time. Your seller bond was returned.');
  return t;
}

async function timeoutRefund(id: string): Promise<Trade> {
  let noop = false;
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (fresh.state !== 'FUNDED' || !passed(fresh.ship_deadline)) {
      noop = true;
      return { trade: fresh, unchanged: true };
    }
    fresh.state = 'REFUNDED';
    fresh.updated_at = iso(now());
    return { trade: fresh, history: { event: 'trade.refunded', from: 'FUNDED', to: 'REFUNDED', actor: 'timeout' } };
  });
  if (noop) return t;
  await enqueuePayoutsForTrade(t); // refund buyer price + bond, return seller bond
  kickPayouts();
  await emit(t, 'trade.refunded', 'FUNDED', 'REFUNDED', { by: 'timeout' });
  await notify(t.buyer_uid, t, 'refunded', 'Auto-refunded — seller no-show', 'The seller missed the ship window. Your payment and bond were returned in full.');
  await notify(t.seller_uid, t, 'refunded', 'Trade refunded', 'You missed the ship window, so the buyer was refunded. Your seller bond was returned.');
  return t;
}

async function timeoutNuclear(id: string): Promise<Trade> {
  let noop = false;
  const t = await repo().runTradeTransition(id, (fresh) => {
    if (fresh.state !== 'DISPUTED' || !passed(fresh.settlement_deadline)) {
      noop = true;
      return { trade: fresh, unchanged: true };
    }
    fresh.state = 'NUCLEAR';
    fresh.updated_at = iso(now());
    return { trade: fresh, history: { event: 'trade.nuclear', from: 'DISPUTED', to: 'NUCLEAR', actor: 'timeout' } };
  });
  if (noop) return t;
  await enqueuePayoutsForTrade(t); // 50/50 principal split; bonds stay (burned)
  kickPayouts();
  await emit(t, 'trade.nuclear', 'DISPUTED', 'NUCLEAR', {});
  await notify(t.seller_uid, t, 'nuclear', 'Nuclear outcome', 'No settlement was reached. Both bonds were burned and the principal split 50/50.');
  await notify(t.buyer_uid, t, 'nuclear', 'Nuclear outcome', 'No settlement was reached. Both bonds were burned and the principal split 50/50.');
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

  const t1 = await createTrade({
    sellerUid: uid, sellerUsername: username,
    amountMicro: P * 8n, shipWindowS: PARAMS.SHIP_DEFAULT_S, inspectWindowS: PARAMS.INSPECT_DEFAULT_S,
    memo: 'Custom phone case, matte black',
  });
  await bondTrade(t1.id, uid, 'demo-bond-1');

  const t2 = await createTrade({
    sellerUid: 'pi_demo_chidi', sellerUsername: 'chidi_makes',
    amountMicro: P * 12n, shipWindowS: PARAMS.SHIP_DEFAULT_S, inspectWindowS: PARAMS.INSPECT_DEFAULT_S,
    memo: 'Hand-woven Aso-Oke fabric, 2 yards',
  });
  await bondTrade(t2.id, 'pi_demo_chidi', 'demo-bond-2');
  await fundTrade(t2.id, uid, username, 'demo-tx-2');

  const t3 = await createTrade({
    sellerUid: 'pi_demo_amaka', sellerUsername: 'amaka_store',
    amountMicro: P * 20n, shipWindowS: PARAMS.SHIP_DEFAULT_S, inspectWindowS: PARAMS.INSPECT_DEFAULT_S,
    memo: 'Bluetooth speaker, brand new',
  });
  await bondTrade(t3.id, 'pi_demo_amaka', 'demo-bond-3');
  await fundTrade(t3.id, uid, username, 'demo-tx-3');
  await markShipped(t3.id, 'pi_demo_amaka', 'demo-evidence-hash');
  await openDispute(t3.id, uid);
  await proposeSettlement(t3.id, 'pi_demo_amaka', 70);

  const t4 = await createTrade({
    sellerUid: uid, sellerUsername: username,
    amountMicro: P * 6n, shipWindowS: PARAMS.SHIP_DEFAULT_S, inspectWindowS: PARAMS.INSPECT_DEFAULT_S,
    memo: 'Beaded necklace set',
  });
  await bondTrade(t4.id, uid, 'demo-bond-4');
  await fundTrade(t4.id, 'pi_demo_ngozi', 'ngozi_buys', 'demo-tx-4');
  await markShipped(t4.id, uid, 'demo-evidence-4');
  await confirmReceipt(t4.id, 'pi_demo_ngozi');
  // Mutual feedback on the completed trade, so the reputation UI has content.
  await rateCounterparty(t4.id, 'pi_demo_ngozi', 'ngozi_buys', true, 'Fast shipping, exactly as described!');
  await rateCounterparty(t4.id, uid, username, true, 'Smooth buyer, paid right away.');
}

// Re-export Profile for convenience
export type { Profile };
