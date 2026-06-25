import 'server-only';
import type {
  Trade, TradeEvent, SettlementProposal, Evidence, AppNotification, Profile,
  Partner, WebhookDelivery, Rating,
} from '../types';
import { DEFAULT_LIMIT_MICRO } from '../tiers';
import { firebaseConfigured } from '../firebase';
import { MemoryRepo } from './memory-repo';
import { FirestoreRepo } from './firestore-repo';

/** Fill defaults for fields added after launch, so legacy docs read cleanly and
 *  never round-trip an `undefined` (which Firestore rejects). A missing
 *  trade_limit_micro means a legacy seller → defaults to the Starter cap, so a
 *  higher tier still requires opting in. `null` (unlimited) is preserved. */
export function normalizeProfile(p: Profile): Profile {
  return {
    ...p,
    trade_limit_micro:
      p.trade_limit_micro === undefined ? DEFAULT_LIMIT_MICRO.toString() : p.trade_limit_micro,
    seller_pos_count: p.seller_pos_count ?? 0,
    seller_rating_count: p.seller_rating_count ?? 0,
    buyer_pos_count: p.buyer_pos_count ?? 0,
    buyer_rating_count: p.buyer_rating_count ?? 0,
  };
}

/**
 * Persistence interface. Two implementations:
 *  - FirestoreRepo  (production / emulator)
 *  - MemoryRepo     (no-config fallback, also the unit-test backend)
 *
 * The transition logic in lib/store.ts is backend-agnostic — it only talks to
 * this interface, so the escrow rules are identical regardless of where data lives.
 */
export interface Repo {
  // users / profiles
  upsertUser(uid: string, username: string): Promise<Profile>;
  getProfile(uid: string): Promise<Profile | null>;
  saveProfile(p: Profile): Promise<void>;

  // trades
  insertTrade(t: Trade): Promise<void>;
  getTrade(id: string): Promise<Trade | null>;
  saveTrade(t: Trade): Promise<void>;
  getTradeByRef(partnerId: string | null, ref: string): Promise<Trade | null>;
  getTradeByIdempotency(partnerId: string | null, key: string): Promise<Trade | null>;
  listTradesForUser(uid: string): Promise<Trade[]>;
  listActiveTrades(): Promise<Trade[]>;

  // events
  addEvent(e: TradeEvent): Promise<void>;
  listEvents(tradeId: string): Promise<TradeEvent[]>;

  // ratings (mutual buyer↔seller feedback)
  addRating(r: Rating): Promise<void>;
  getRatingByRater(tradeId: string, raterUid: string): Promise<Rating | null>;
  listRatingsForTrade(tradeId: string): Promise<Rating[]>;
  listRatingsAbout(uid: string): Promise<Rating[]>;

  // settlement proposals
  addProposal(p: SettlementProposal): Promise<void>;
  saveProposal(p: SettlementProposal): Promise<void>;
  listProposals(tradeId: string): Promise<SettlementProposal[]>;

  // evidence
  addEvidence(e: Evidence): Promise<void>;
  listEvidence(tradeId: string): Promise<Evidence[]>;

  // notifications
  addNotification(n: AppNotification): Promise<void>;
  listNotifications(uid: string): Promise<AppNotification[]>;
  markNotificationsRead(uid: string): Promise<void>;

  // partners + webhooks (public API)
  insertPartner(p: Partner): Promise<void>;
  getPartner(id: string): Promise<Partner | null>;
  getPartnerByKeyHash(hash: string): Promise<Partner | null>;
  addWebhookDelivery(d: WebhookDelivery): Promise<void>;
  saveWebhookDelivery(d: WebhookDelivery): Promise<void>;
  listDueWebhookDeliveries(): Promise<WebhookDelivery[]>;
}

let _repo: Repo | null = null;

export function repo(): Repo {
  if (!_repo) {
    _repo = firebaseConfigured() ? new FirestoreRepo() : new MemoryRepo();
  }
  return _repo;
}

export function backendName(): 'firestore' | 'memory' {
  return firebaseConfigured() ? 'firestore' : 'memory';
}
