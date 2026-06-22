import 'server-only';
import { randomUUID, createHmac } from 'crypto';
import { repo } from './db/repo';
import type { Trade, Partner, WebhookDelivery } from './types';

/**
 * Webhook delivery (PRD §9). Outbox pattern: every event for a partner-owned
 * trade is recorded as a durable `pending` delivery, then attempted immediately
 * (best-effort) and retried by the cron worker with exponential backoff. The
 * body is signed with HMAC-SHA256 using the partner's webhook secret.
 *
 * Source-of-truth note: in production these fire from the chain indexer after an
 * event confirms on-chain — never from optimistic state.
 */

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];

function nextAttemptAt(attempts: number): string {
  const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
  return new Date(Date.now() + delay).toISOString();
}

export function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Record + best-effort send a webhook for a trade event. No-op if no partner. */
export async function dispatchWebhook(
  trade: Trade,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!trade.partner_id) return;
  const partner = await repo().getPartner(trade.partner_id);
  if (!partner?.webhook_url) return;

  const now = new Date().toISOString();
  const delivery: WebhookDelivery = {
    id: randomUUID(),
    partner_id: partner.id,
    trade_id: trade.id,
    event,
    payload: { event, trade_id: trade.id, contract_trade_id: trade.contract_trade_id, state: trade.state, ...payload },
    attempts: 0,
    status: 'pending',
    last_error: null,
    next_attempt_at: now,
    created_at: now,
    updated_at: now,
  };
  await repo().addWebhookDelivery(delivery);
  // Best-effort immediate attempt; durability is guaranteed by the cron retry.
  void attemptDelivery(delivery, partner).catch(() => {});
}

async function attemptDelivery(delivery: WebhookDelivery, partner: Partner): Promise<void> {
  const body = JSON.stringify(delivery.payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (partner.webhook_secret) headers['X-Clasp-Signature'] = `sha256=${sign(partner.webhook_secret, body)}`;

  const attempts = delivery.attempts + 1;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(partner.webhook_url!, { method: 'POST', headers, body, signal: ctrl.signal });
    clearTimeout(to);
    if (res.ok) {
      await repo().saveWebhookDelivery({ ...delivery, attempts, status: 'delivered', last_error: null, updated_at: new Date().toISOString() });
      return;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    const failed = attempts >= MAX_ATTEMPTS;
    await repo().saveWebhookDelivery({
      ...delivery,
      attempts,
      status: failed ? 'failed' : 'pending',
      last_error: e instanceof Error ? e.message : 'delivery error',
      next_attempt_at: nextAttemptAt(attempts),
      updated_at: new Date().toISOString(),
    });
  }
}

/** Cron entry point: retry all due deliveries. Returns how many were attempted. */
export async function retryDueWebhooks(): Promise<number> {
  const due = await repo().listDueWebhookDeliveries();
  for (const d of due) {
    const partner = await repo().getPartner(d.partner_id);
    if (partner?.webhook_url) await attemptDelivery(d, partner);
  }
  return due.length;
}
