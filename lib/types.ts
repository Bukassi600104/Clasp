import type { TradeState } from './escrow';

/** Public-facing trade shape returned by the API and rendered by the app. */
export interface Trade {
  id: string;
  contract_trade_id: string | null;
  seller_uid: string;
  seller_username: string | null;
  buyer_uid: string | null;
  buyer_username: string | null;
  amount_micro: string; // bigint serialized as string
  buyer_bond_micro: string;
  seller_bond_micro: string;
  fee_micro: string;
  /** Who pays the separate 1.5% platform fee — chosen by the seller at creation.
   *  Absent on legacy trades → treated as 'seller' (fee carved from proceeds). */
  fee_payer?: 'seller' | 'buyer';
  /** Whether the seller has posted their security bond (paid via Pi at creation).
   *  New trades start false and become true once the bond payment completes; a
   *  buyer cannot fund until it is true. Absent on legacy trades → treated as paid. */
  seller_bond_paid?: boolean;
  seller_bond_txid?: string | null;
  memo: string;
  ship_window_s: number;
  inspect_window_s: number;
  state: TradeState;
  // deadline timestamps (ISO) — present once the relevant window opens
  funding_deadline: string | null;
  ship_deadline: string | null;
  inspect_deadline: string | null;
  settlement_deadline: string | null;
  evidence_hash: string | null;
  /** True once the trade ever entered a dispute — excludes it from a seller's
   *  qualifying (clean) trade count. (COMPLETED implies false by construction.) */
  disputed?: boolean;
  partner_id: string | null;
  ref: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface TradeEvent {
  id: string;
  trade_id: string;
  event: string;
  from_state: TradeState | null;
  to_state: TradeState | null;
  chain_tx: string | null;
  payload: Record<string, unknown>;
  confirmed_at: string;
}

export interface SettlementProposal {
  id: string;
  trade_id: string;
  proposer_uid: string;
  seller_pct: number;
  status: 'open' | 'accepted' | 'superseded';
  created_at: string;
}

export interface Evidence {
  id: string;
  trade_id: string;
  uploader_uid: string;
  storage_path: string;
  caption: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  uid: string;
  trade_id: string | null;
  type: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface Profile {
  pi_uid: string;
  username: string;
  trades_total: number;
  trades_completed: number;
  distinct_counterparties: number;
  disputes_total: number;
  /** Seller's chosen per-trade cap (micro-Pi as string). null = unlimited
   *  (Elite only). undefined on legacy docs → treated as the Starter default. */
  trade_limit_micro?: string | null;
  /** Rating aggregates — positive-feedback counts. Received AS a seller vs AS a
   *  buyer, kept separate so a counterparty sees the score for the role that
   *  matters to them. % positive = pos_count / rating_count. */
  seller_pos_count?: number;
  seller_rating_count?: number;
  buyer_pos_count?: number;
  buyer_rating_count?: number;
  created_at: string;
}

/** A mutual rating left after a funded trade reaches a terminal outcome.
 *  Binary positive/negative feedback (à la P2P exchanges), aggregated to a
 *  "% positive" score — a sharper trust signal than stars, which collapse to ~5. */
export interface Rating {
  id: string;
  trade_id: string;
  rater_uid: string;
  rater_username: string | null;
  ratee_uid: string;
  /** The role the *ratee* played in this trade. */
  ratee_role: 'seller' | 'buyer';
  positive: boolean; // 👍 true / 👎 false
  comment: string | null;
  created_at: string;
}

/** Aggregate rating shown in the UI. */
export interface RatingSummary {
  positivePct: number | null; // 0..100, null if never rated in this role
  count: number;
}

/** A custodial App-to-User payout owed to a party once a trade settles. One per
 *  (trade, role); id = `${trade_id}:${role}` makes enqueue/settlement idempotent.
 *  The resumable create→submit→complete cycle persists payment_id then txid so a
 *  retry never creates a second on-chain payment (no double-pay). */
export interface Payout {
  id: string;
  trade_id: string;
  role: 'seller' | 'buyer';
  uid: string;
  amount_micro: string;
  reason: 'completed' | 'refunded' | 'settled' | 'nuclear';
  status: 'pending' | 'paid' | 'failed';
  payment_id: string | null;
  txid: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface SessionUser {
  uid: string;
  username: string;
}

/** Public trust stats shown to counterparties (e.g. a buyer on checkout). */
export interface PublicStats {
  username: string;
  successful: number; // completed + settled trades — the "safe trades" count
  completed: number;
  settled: number;
  distinct_counterparties: number;
  completion_rate: number | null; // % of funded-terminal trades that ended well
  /** Clean (never-disputed) completed trades as a seller — drives the tier. */
  qualifying: number;
  tier: { id: number; name: string; tone: string; ceiling_micro: string | null };
  seller_rating: RatingSummary;
  buyer_rating: RatingSummary;
}

export interface Partner {
  id: string;
  name: string;
  api_key_hash: string;
  webhook_url: string | null;
  webhook_secret: string | null;
  tier: string;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  partner_id: string;
  trade_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  status: 'pending' | 'delivered' | 'failed';
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
}
