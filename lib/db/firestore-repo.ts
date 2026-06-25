import 'server-only';
import type { Repo } from './repo';
import { normalizeProfile } from './repo';
import type {
  Trade, TradeEvent, SettlementProposal, Evidence, AppNotification, Profile,
  Partner, WebhookDelivery, Rating,
} from '../types';
import { NON_TERMINAL } from '../escrow';
import { DEFAULT_LIMIT_MICRO } from '../tiers';
import { db } from '../firebase';

/**
 * Firestore implementation. Queries are kept single-field and sorted in memory
 * so no composite indexes are required (keeps deploys zero-config). Collections:
 * users, trades, trade_events, settlement_proposals, evidence, notifications,
 * partners, webhook_deliveries.
 */
export class FirestoreRepo implements Repo {
  private get c() { return db(); }

  // ── users ──
  async upsertUser(uid: string, username: string): Promise<Profile> {
    const ref = this.c.collection('users').doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      const p: Profile = {
        pi_uid: uid, username,
        trades_total: 0, trades_completed: 0, distinct_counterparties: 0, disputes_total: 0,
        trade_limit_micro: DEFAULT_LIMIT_MICRO.toString(),
        seller_pos_count: 0, seller_rating_count: 0, buyer_pos_count: 0, buyer_rating_count: 0,
        created_at: new Date().toISOString(),
      };
      await ref.set(p);
      return p;
    }
    const p = snap.data() as Profile;
    if (username && p.username !== username) {
      await ref.update({ username });
      p.username = username;
    }
    return normalizeProfile(p);
  }
  async getProfile(uid: string) {
    const snap = await this.c.collection('users').doc(uid).get();
    return snap.exists ? normalizeProfile(snap.data() as Profile) : null;
  }
  async saveProfile(p: Profile) {
    await this.c.collection('users').doc(p.pi_uid).set(p);
  }

  // ── trades ──
  async insertTrade(t: Trade) { await this.c.collection('trades').doc(t.id).set(t); }
  async getTrade(id: string) {
    const snap = await this.c.collection('trades').doc(id).get();
    return snap.exists ? (snap.data() as Trade) : null;
  }
  async saveTrade(t: Trade) { await this.c.collection('trades').doc(t.id).set(t); }
  async getTradeByRef(partnerId: string | null, ref: string) {
    const q = await this.c.collection('trades').where('ref', '==', ref).get();
    const hit = q.docs.map((d) => d.data() as Trade).find((t) => t.partner_id === partnerId);
    return hit ?? null;
  }
  async getTradeByIdempotency(partnerId: string | null, key: string) {
    const q = await this.c.collection('trades').where('idempotency_key', '==', key).get();
    const hit = q.docs.map((d) => d.data() as Trade).find((t) => t.partner_id === partnerId);
    return hit ?? null;
  }
  async listTradesForUser(uid: string) {
    const [asSeller, asBuyer] = await Promise.all([
      this.c.collection('trades').where('seller_uid', '==', uid).get(),
      this.c.collection('trades').where('buyer_uid', '==', uid).get(),
    ]);
    const map = new Map<string, Trade>();
    for (const d of [...asSeller.docs, ...asBuyer.docs]) map.set(d.id, d.data() as Trade);
    return [...map.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async listActiveTrades() {
    const q = await this.c.collection('trades').where('state', 'in', NON_TERMINAL).get();
    return q.docs.map((d) => d.data() as Trade);
  }

  // ── events ──
  async addEvent(e: TradeEvent) { await this.c.collection('trade_events').doc(e.id).set(e); }
  async listEvents(tradeId: string) {
    const q = await this.c.collection('trade_events').where('trade_id', '==', tradeId).get();
    return q.docs.map((d) => d.data() as TradeEvent)
      .sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at));
  }

  // ── ratings ──
  async addRating(r: Rating) { await this.c.collection('ratings').doc(r.id).set(r); }
  async getRatingByRater(tradeId: string, raterUid: string) {
    const q = await this.c.collection('ratings').where('trade_id', '==', tradeId).get();
    const hit = q.docs.map((d) => d.data() as Rating).find((r) => r.rater_uid === raterUid);
    return hit ?? null;
  }
  async listRatingsForTrade(tradeId: string) {
    const q = await this.c.collection('ratings').where('trade_id', '==', tradeId).get();
    return q.docs.map((d) => d.data() as Rating);
  }
  async listRatingsAbout(uid: string) {
    const q = await this.c.collection('ratings').where('ratee_uid', '==', uid).get();
    return q.docs.map((d) => d.data() as Rating)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ── proposals ──
  async addProposal(p: SettlementProposal) { await this.c.collection('settlement_proposals').doc(p.id).set(p); }
  async saveProposal(p: SettlementProposal) { await this.c.collection('settlement_proposals').doc(p.id).set(p); }
  async listProposals(tradeId: string) {
    const q = await this.c.collection('settlement_proposals').where('trade_id', '==', tradeId).get();
    return q.docs.map((d) => d.data() as SettlementProposal)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // ── evidence ──
  async addEvidence(e: Evidence) { await this.c.collection('evidence').doc(e.id).set(e); }
  async listEvidence(tradeId: string) {
    const q = await this.c.collection('evidence').where('trade_id', '==', tradeId).get();
    return q.docs.map((d) => d.data() as Evidence)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // ── notifications ──
  async addNotification(n: AppNotification) { await this.c.collection('notifications').doc(n.id).set(n); }
  async listNotifications(uid: string) {
    const q = await this.c.collection('notifications').where('uid', '==', uid).get();
    return q.docs.map((d) => d.data() as AppNotification)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async markNotificationsRead(uid: string) {
    const q = await this.c.collection('notifications')
      .where('uid', '==', uid).where('read_at', '==', null).get();
    const now = new Date().toISOString();
    const batch = this.c.batch();
    q.docs.forEach((d) => batch.update(d.ref, { read_at: now }));
    if (q.size) await batch.commit();
  }

  // ── partners + webhooks ──
  async insertPartner(p: Partner) { await this.c.collection('partners').doc(p.id).set(p); }
  async getPartner(id: string) {
    const snap = await this.c.collection('partners').doc(id).get();
    return snap.exists ? (snap.data() as Partner) : null;
  }
  async getPartnerByKeyHash(hash: string) {
    const q = await this.c.collection('partners').where('api_key_hash', '==', hash).limit(1).get();
    return q.empty ? null : (q.docs[0].data() as Partner);
  }
  async addWebhookDelivery(d: WebhookDelivery) { await this.c.collection('webhook_deliveries').doc(d.id).set(d); }
  async saveWebhookDelivery(d: WebhookDelivery) { await this.c.collection('webhook_deliveries').doc(d.id).set(d); }
  async listDueWebhookDeliveries() {
    const q = await this.c.collection('webhook_deliveries').where('status', '==', 'pending').get();
    const now = Date.now();
    return q.docs.map((d) => d.data() as WebhookDelivery)
      .filter((d) => new Date(d.next_attempt_at).getTime() <= now);
  }
}
