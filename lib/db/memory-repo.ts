import 'server-only';
import { randomUUID } from 'crypto';
import type { Repo, TransitionResult } from './repo';
import { normalizeProfile } from './repo';
import type {
  Trade, TradeEvent, SettlementProposal, Evidence, AppNotification, Profile,
  Partner, WebhookDelivery, Rating, Payout, StateHistoryEntry, PaymentIntent,
  PaymentLog,
} from '../types';
import { isTerminal } from '../escrow';
import { DEFAULT_LIMIT_MICRO } from '../tiers';
import { TransitionError } from '../errors';

/**
 * In-memory repository. Default when Firebase is not configured. Suitable for a
 * single long-running process (local dev, tests). Not for Vercel serverless,
 * where instances are ephemeral — use Firestore there.
 */
export class MemoryRepo implements Repo {
  private trades = new Map<string, Trade>();
  private events: TradeEvent[] = [];
  private proposals: SettlementProposal[] = [];
  private evidences: Evidence[] = [];
  private notifications: AppNotification[] = [];
  private profiles = new Map<string, Profile>();
  private partners = new Map<string, Partner>();
  private deliveries = new Map<string, WebhookDelivery>();
  private ratings: Rating[] = [];
  private payouts = new Map<string, Payout>();
  private stateHistory: StateHistoryEntry[] = [];
  private intents = new Map<string, PaymentIntent>();
  private paymentLogs: PaymentLog[] = [];
  /** Per-trade promise chain that serializes transitions, mirroring the mutual
   *  exclusion a Firestore transaction gives the production backend. */
  private tradeLocks = new Map<string, Promise<unknown>>();

  async upsertUser(uid: string, username: string): Promise<Profile> {
    let p = this.profiles.get(uid);
    if (!p) {
      p = {
        pi_uid: uid, username,
        trades_total: 0, trades_completed: 0, distinct_counterparties: 0, disputes_total: 0,
        trade_limit_micro: DEFAULT_LIMIT_MICRO.toString(),
        seller_pos_count: 0, seller_rating_count: 0, buyer_pos_count: 0, buyer_rating_count: 0,
        created_at: new Date().toISOString(),
      };
      this.profiles.set(uid, p);
    } else if (username && p.username !== username) {
      p.username = username;
    }
    return normalizeProfile({ ...p });
  }
  async getProfile(uid: string) {
    const p = this.profiles.get(uid);
    return p ? normalizeProfile({ ...p }) : null;
  }
  async saveProfile(p: Profile) {
    this.profiles.set(p.pi_uid, { ...p });
  }

  async insertTrade(t: Trade) { this.trades.set(t.id, { ...t }); }
  async getTrade(id: string) {
    const t = this.trades.get(id);
    return t ? { ...t } : null;
  }
  async saveTrade(t: Trade) { this.trades.set(t.id, { ...t }); }

  async runTradeTransition(id: string, mutate: (t: Trade) => TransitionResult): Promise<Trade> {
    const prev = this.tradeLocks.get(id) ?? Promise.resolve();
    const run = prev.then(() => {
      const current = this.trades.get(id);
      if (!current) throw new TransitionError('Trade not found.');
      const res = mutate({ ...current });
      if (res.unchanged) return res.trade;
      this.trades.set(id, { ...res.trade });
      if (res.history) {
        this.stateHistory.push({
          id: randomUUID(),
          trade_id: id,
          event: res.history.event,
          from_state: res.history.from,
          to_state: res.history.to,
          actor: res.history.actor,
          payload: res.history.payload ?? {},
          at: new Date().toISOString(),
        });
      }
      return res.trade;
    });
    // Keep the chain alive whether this transition commits or throws.
    this.tradeLocks.set(id, run.catch(() => {}));
    return run;
  }
  async listStateHistory(tradeId: string) {
    return this.stateHistory.filter((h) => h.trade_id === tradeId)
      .map((h) => ({ ...h }))
      .sort((a, b) => a.at.localeCompare(b.at));
  }
  async getTradeByRef(partnerId: string | null, ref: string) {
    for (const t of this.trades.values())
      if (t.ref === ref && t.partner_id === partnerId) return { ...t };
    return null;
  }
  async getTradeByIdempotency(partnerId: string | null, key: string) {
    for (const t of this.trades.values())
      if (t.idempotency_key === key && t.partner_id === partnerId) return { ...t };
    return null;
  }
  async listTradesForUser(uid: string) {
    return [...this.trades.values()]
      .filter((t) => t.seller_uid === uid || t.buyer_uid === uid)
      .map((t) => ({ ...t }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async listActiveTrades() {
    return [...this.trades.values()].filter((t) => !isTerminal(t.state)).map((t) => ({ ...t }));
  }

  async addEvent(e: TradeEvent) { this.events.push({ ...e }); }
  async listEvents(tradeId: string) {
    return this.events.filter((e) => e.trade_id === tradeId)
      .map((e) => ({ ...e }))
      .sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at));
  }

  async addRating(r: Rating) { this.ratings.push({ ...r }); }
  async getRatingByRater(tradeId: string, raterUid: string) {
    const hit = this.ratings.find((r) => r.trade_id === tradeId && r.rater_uid === raterUid);
    return hit ? { ...hit } : null;
  }
  async listRatingsForTrade(tradeId: string) {
    return this.ratings.filter((r) => r.trade_id === tradeId).map((r) => ({ ...r }));
  }
  async listRatingsAbout(uid: string) {
    return this.ratings.filter((r) => r.ratee_uid === uid)
      .map((r) => ({ ...r }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async addProposal(p: SettlementProposal) { this.proposals.push({ ...p }); }
  async saveProposal(p: SettlementProposal) {
    const i = this.proposals.findIndex((x) => x.id === p.id);
    if (i >= 0) this.proposals[i] = { ...p };
  }
  async listProposals(tradeId: string) {
    return this.proposals.filter((p) => p.trade_id === tradeId)
      .map((p) => ({ ...p }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async addEvidence(e: Evidence) { this.evidences.push({ ...e }); }
  async listEvidence(tradeId: string) {
    return this.evidences.filter((e) => e.trade_id === tradeId)
      .map((e) => ({ ...e }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async addNotification(n: AppNotification) { this.notifications.push({ ...n }); }
  async listNotifications(uid: string) {
    return this.notifications.filter((n) => n.uid === uid)
      .map((n) => ({ ...n }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async markNotificationsRead(uid: string) {
    const now = new Date().toISOString();
    for (const n of this.notifications) if (n.uid === uid && !n.read_at) n.read_at = now;
  }

  async upsertPaymentIntent(i: PaymentIntent) { this.intents.set(i.payment_id, { ...i }); }
  async getPaymentIntent(paymentId: string) {
    const i = this.intents.get(paymentId);
    return i ? { ...i } : null;
  }
  async listCompletingIntents(olderThanIso: string) {
    return [...this.intents.values()]
      .filter((i) => i.status === 'completing' && i.created_at <= olderThanIso)
      .map((i) => ({ ...i }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async addPaymentLog(l: PaymentLog) { this.paymentLogs.push({ ...l }); }

  async addPayout(p: Payout) { this.payouts.set(p.id, { ...p }); }
  async getPayout(id: string) {
    const p = this.payouts.get(id);
    return p ? { ...p } : null;
  }
  async savePayout(p: Payout) { this.payouts.set(p.id, { ...p }); }
  async listPendingPayouts() {
    return [...this.payouts.values()].filter((p) => p.status === 'pending')
      .map((p) => ({ ...p }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async listPayoutsForTrade(tradeId: string) {
    return [...this.payouts.values()].filter((p) => p.trade_id === tradeId).map((p) => ({ ...p }));
  }

  async insertPartner(p: Partner) { this.partners.set(p.id, { ...p }); }
  async getPartner(id: string) {
    const p = this.partners.get(id);
    return p ? { ...p } : null;
  }
  async getPartnerByKeyHash(hash: string) {
    for (const p of this.partners.values()) if (p.api_key_hash === hash) return { ...p };
    return null;
  }
  async addWebhookDelivery(d: WebhookDelivery) { this.deliveries.set(d.id, { ...d }); }
  async saveWebhookDelivery(d: WebhookDelivery) { this.deliveries.set(d.id, { ...d }); }
  async listDueWebhookDeliveries() {
    const now = Date.now();
    return [...this.deliveries.values()]
      .filter((d) => d.status === 'pending' && new Date(d.next_attempt_at).getTime() <= now)
      .map((d) => ({ ...d }));
  }
}
