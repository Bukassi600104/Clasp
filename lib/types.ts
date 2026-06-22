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
  created_at: string;
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
