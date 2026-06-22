import 'server-only';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { repo } from './db/repo';
import type { Partner } from './types';

/**
 * Partner API keys (PRD §9). Keys are shown once at creation and stored only as
 * a SHA-256 hash. The reference app uses a first-party key just like any partner.
 */

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function generateApiKey(): { key: string; hash: string } {
  const live = process.env.PI_API_KEY ? 'live' : 'test';
  const key = `clasp_${live}_${randomBytes(24).toString('hex')}`;
  return { key, hash: hashKey(key) };
}

export async function createPartner(name: string): Promise<{ partner: Partner; apiKey: string }> {
  const { key, hash } = generateApiKey();
  const partner: Partner = {
    id: randomUUID(),
    name,
    api_key_hash: hash,
    webhook_url: null,
    webhook_secret: null,
    tier: 'free',
    created_at: new Date().toISOString(),
  };
  await repo().insertPartner(partner);
  return { partner, apiKey: key };
}

export async function registerWebhook(
  partnerId: string, url: string, secret: string | null
): Promise<Partner | null> {
  const partner = await repo().getPartner(partnerId);
  if (!partner) return null;
  const updated: Partner = { ...partner, webhook_url: url, webhook_secret: secret };
  await repo().insertPartner(updated); // upsert by id
  return updated;
}

/** Resolve the partner from a Bearer token, constant-time comparing the hash. */
export async function authenticatePartner(req: Request): Promise<Partner | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const partner = await repo().getPartnerByKeyHash(hashKey(token));
  if (!partner) return null;
  // Defense-in-depth: confirm the stored hash matches in constant time.
  const a = Buffer.from(partner.api_key_hash);
  const b = Buffer.from(hashKey(token));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return partner;
}
