import 'server-only';
import type { Repo } from './repo';
import type {
  Trade, TradeEvent, SettlementProposal, Evidence, AppNotification, Profile,
  Partner, WebhookDelivery,
} from '../types';
import { isTerminal } from '../escrow';

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

  async upsertUser(uid: string, username: string): Promise<Profile> {
    let p = this.profiles.get(uid);
    if (!p) {
      p = {
        pi_uid: uid, username,
        trades_total: 0, trades_completed: 0, distinct_counterparties: 0, disputes_total: 0,
        created_at: new Date().toISOString(),
      };
      this.profiles.set(uid, p);
    } else if (username && p.username !== username) {
      p.username = username;
    }
    return { ...p };
  }
  async getProfile(uid: string) {
    const p = this.profiles.get(uid);
    return p ? { ...p } : null;
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
