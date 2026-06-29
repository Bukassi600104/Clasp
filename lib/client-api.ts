'use client';

import type { Trade, TradeEvent, SettlementProposal, Evidence, AppNotification, PublicStats, Rating } from './types';

export interface TradeDetail {
  trade: Trade;
  events: TradeEvent[];
  proposals: SettlementProposal[];
  evidence: Evidence[];
  sellerStats: PublicStats | null;
  buyerStats: PublicStats | null;
  ratings: Rating[];
}

export interface OwnProfileView {
  stats: PublicStats;
  chosen_limit_micro: string | null;
  effective_limit_micro: string | null;
  reviews: Rating[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    // SECURITY/COMPAT: send the session cookie even though the app runs in a
    // third-party iframe on pinet.com (works with the Partitioned cookie).
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error ?? `Request failed (${res.status}).`);
  }
  return json.data as T;
}

export const api = {
  createTrade: (body: {
    amount: number;
    shipWindowS: number;
    inspectWindowS: number;
    memo: string;
    feePayer?: 'seller' | 'buyer';
  }) => call<Trade>('/api/trades', { method: 'POST', body: JSON.stringify(body) }),

  myTrades: () => call<Trade[]>('/api/trades'),

  trade: (id: string) => call<TradeDetail>(`/api/trades/${id}`),

  fund: (id: string, txid?: string) =>
    call<Trade>(`/api/trades/${id}/fund`, { method: 'POST', body: JSON.stringify({ txid }) }),

  ship: (id: string, evidenceNote: string) =>
    call<Trade>(`/api/trades/${id}/ship`, { method: 'POST', body: JSON.stringify({ evidenceNote }) }),

  confirm: (id: string) => call<Trade>(`/api/trades/${id}/confirm`, { method: 'POST' }),

  dispute: (id: string) => call<Trade>(`/api/trades/${id}/dispute`, { method: 'POST' }),

  propose: (id: string, sellerPct: number) =>
    call<{ trade: Trade; proposal: SettlementProposal }>(`/api/trades/${id}/propose`, {
      method: 'POST',
      body: JSON.stringify({ sellerPct }),
    }),

  accept: (id: string, proposalId: string) =>
    call<Trade>(`/api/trades/${id}/accept`, { method: 'POST', body: JSON.stringify({ proposalId }) }),

  addEvidence: (id: string, body: { caption?: string; image?: string }) =>
    call<Evidence>(`/api/trades/${id}/evidence`, { method: 'POST', body: JSON.stringify(body) }),

  cancel: (id: string) => call<Trade>(`/api/trades/${id}/cancel`, { method: 'POST' }),

  reactivate: (id: string) => call<Trade>(`/api/trades/${id}/reactivate`, { method: 'POST' }),

  timeout: (id: string) => call<Trade>(`/api/trades/${id}/timeout`, { method: 'POST' }),

  rate: (id: string, positive: boolean, comment?: string) =>
    call<Rating>(`/api/trades/${id}/rate`, {
      method: 'POST',
      body: JSON.stringify({ positive, comment }),
    }),

  profile: () => call<OwnProfileView>('/api/profile'),

  setLimit: (limitPi: number | null) =>
    call<OwnProfileView>('/api/profile', { method: 'POST', body: JSON.stringify({ limitPi }) }),

  notifications: () => call<AppNotification[]>('/api/notifications'),
  markRead: () => call<{ read: boolean }>('/api/notifications', { method: 'POST' }),

  approvePayment: (paymentId: string, tradeId: string) =>
    call<{ approved: boolean }>('/api/payments/approve', {
      method: 'POST',
      body: JSON.stringify({ paymentId, tradeId }),
    }),

  completePayment: (paymentId: string, txid: string, tradeId: string) =>
    call<Trade>('/api/payments/complete', {
      method: 'POST',
      body: JSON.stringify({ paymentId, txid, tradeId }),
    }),
};
