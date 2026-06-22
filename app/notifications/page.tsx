'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client-api';
import { useAuth } from '@/app/providers';
import type { AppNotification } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { AppBar, BottomNav } from '@/components/chrome';
import { Bell, Lock, Truck, Check, Scale, Flame } from '@/components/icons';

const ICONS: Record<string, typeof Bell> = {
  funded: Lock, shipped: Truck, completed: Check, refunded: Check,
  disputed: Scale, settlement_proposed: Scale, settled: Check,
  nuclear: Flame, cancelled: Bell,
};

export default function NotificationsPage() {
  const { user, refresh } = useAuth();
  const [items, setItems] = useState<AppNotification[] | null>(null);

  useEffect(() => {
    if (!user) return;
    api.notifications().then(async (n) => {
      setItems(n);
      await api.markRead();
      refresh();
    }).catch(() => setItems([]));
  }, [user, refresh]);

  if (!user) return <div className="min-h-[100dvh] grid place-items-center text-muted">Sign in to view activity.</div>;

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <AppBar title="Activity" />

      <main className="px-5 pt-4 pb-8 flex-1">
        {!items && <div className="space-y-3">{[0,1,2].map(i => <div key={i} className="card h-20 animate-pulse" />)}</div>}

        {items && items.length === 0 && (
          <div className="card p-8 text-center mt-4">
            <span className="mx-auto grid place-items-center h-14 w-14 rounded-2xl bg-slate-soft text-muted">
              <Bell width={26} height={26} />
            </span>
            <h3 className="mt-4 font-display text-lg font-semibold">No activity yet</h3>
            <p className="mt-1.5 text-[14px] text-muted">Deadline reminders and trade updates will appear here.</p>
          </div>
        )}

        <ul className="space-y-3">
          {items?.map((n) => {
            const Icon = ICONS[n.type] ?? Bell;
            const danger = n.type === 'nuclear';
            const inner = (
              <div className={`card p-4 flex gap-3.5 ${!n.read_at ? 'ring-brand/25' : ''}`}>
                <span className={`grid place-items-center h-10 w-10 rounded-xl shrink-0 ${
                  danger ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-dark'
                }`}>
                  <Icon width={20} height={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-[14px] text-ink">{n.title}</p>
                    {!n.read_at && <span className="h-2 w-2 rounded-full bg-brand shrink-0" />}
                  </div>
                  <p className="text-[13px] text-muted leading-snug mt-0.5">{n.body}</p>
                  <p className="text-[11px] text-faint mt-1.5 tnum">{formatDate(n.created_at)}</p>
                </div>
              </div>
            );
            return (
              <li key={n.id}>
                {n.trade_id ? <Link href={`/trade/${n.trade_id}`}>{inner}</Link> : inner}
              </li>
            );
          })}
        </ul>
      </main>

      <BottomNav />
    </div>
  );
}
