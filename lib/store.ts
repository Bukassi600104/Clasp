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
  t.disputed = true; // permanently excludes this trade from the seller's clean count
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
  const t = await getOrThrow(id);
  if (t.state !== 'CANCELLED')
    throw new TransitionError('Only a cancelled or expired trade can be reactivated.');
  if (t.buyer_uid)
    throw new TransitionError('A trade that was already funded cannot be reactivated.');
  if (byUid !== t.seller_uid)
    throw new TransitionError('Only the seller can reactivate their trade.');
  t.state = 'CREATED';
  t.funding_deadline = plus(PARAMS.FUNDING_WINDOW_S);
  await save(t);
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
  // Mutual feedback on the completed trade, so the reputation UI has content.
  await rateCounterparty(t4.id, 'pi_demo_ngozi', 'ngozi_buys', true, 'Fast shipping, exactly as described!');
  await rateCounterparty(t4.id, uid, username, true, 'Smooth buyer, paid right away.');
}

// Re-export Profile for convenience
export type { Profile };
