'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/providers';
import { api } from '@/lib/client-api';
import type { Trade } from '@/lib/types';
import { isTerminal } from '@/lib/escrow';
import { AppBar, BottomNav } from '@/components/chrome';
import { Avatar } from '@/components/avatar';
import { DonutRing } from '@/components/donut';
import { Shield, Scale, ArrowRight } from '@/components/icons';

const C = {
  completed: '#0E7A53',
  settled: '#1F5E8C',
  refunded: '#B45309',
  dispute: '#A12D26',
};

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const [trades, setTrades] = useState<Trade[] | null>(null);

  useEffect(() => { api.myTrades().then(setTrades).catch(() => setTrades([])); }, []);

  if (!user) return <div className="min-h-[100dvh] grid place-items-center text-muted">Sign in to view your profile.</div>;

  const all = trades ?? [];
  const count = (states: string[]) => all.filter((t) => states.includes(t.state)).length;
  const completed = count(['COMPLETED']);
  const settled = count(['SETTLED']);
  const refunded = count(['REFUNDED']);
  const inDispute = count(['DISPUTED']);
  const nuclear = count(['NUCLEAR']);

  const successful = completed + settled;
  const terminalFunded = completed + settled + refunded + nuclear;
  const completionRate = terminalFunded ? Math.round((successful / terminalFunded) * 100) : null;

  const counterparties = new Set<string>();
  for (const t of all) {
    if (!isTerminal(t.state)) continue;
    const other = t.seller_uid === user.uid ? t.buyer_uid : t.seller_uid;
    if (other) counterparties.add(other);
  }

  const rows = [
    { label: 'Completed', value: completed, color: C.completed },
    { label: 'Settled fairly', value: settled, color: C.settled },
    { label: 'Refunded', value: refunded, color: C.refunded },
    { label: 'In dispute', value: inDispute, color: C.dispute },
    { label: 'Nuclear', value: nuclear, color: '#5C1A16' },
  ].filter((r) => r.value > 0);
  const barMax = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <AppBar title="Profile" />

      <main className="px-5 pt-4 pb-8 flex-1 space-y-5">
        {/* Identity */}
        <div className="flex items-center gap-3.5">
          <Avatar name={user.username} size={56} />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold truncate">@{user.username}</h1>
            <p className="text-[13px] text-muted mt-0.5 flex items-center gap-1.5">
              <Shield width={14} height={14} className="text-brand" /> Pi-verified pioneer
            </p>
          </div>
        </div>

        {/* Trust portfolio — donut of outcomes */}
        <div className="card p-6">
          <div className="flex justify-center">
            <DonutRing
              segments={[
                { value: completed, color: C.completed },
                { value: settled, color: C.settled },
                { value: refunded, color: C.refunded },
                { value: nuclear, color: '#5C1A16' },
              ]}
            >
              <div>
                <p className="font-display text-[40px] leading-none font-semibold tnum">{successful}</p>
                <p className="text-[12px] text-faint mt-1">safe trade{successful === 1 ? '' : 's'}</p>
              </div>
            </DonutRing>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <MiniStat label="Completion rate" value={completionRate != null ? `${completionRate}%` : '—'} />
            <MiniStat label="Distinct people" value={counterparties.size} />
          </div>
        </div>

        {/* Outcome breakdown */}
        {rows.length > 0 ? (
          <div className="card p-5">
            <h2 className="font-display text-lg font-semibold mb-3">Trade breakdown</h2>
            <ul className="space-y-3.5">
              {rows.map((r) => (
                <li key={r.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                      {r.label}
                    </span>
                    <span className="text-[14px] font-semibold tnum">{r.value}</span>
                  </div>
                  <div className="h-2 rounded-full bg-paper overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(r.value / barMax) * 100}%`, background: r.color }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="card p-6 text-center">
            <p className="text-[14px] text-muted">No completed trades yet. Your safe-trade count grows with every successful deal — and other pioneers can see it.</p>
          </div>
        )}

        {/* Reputation explainer */}
        <div className="card p-4 bg-slate-soft ring-0">
          <div className="flex gap-3">
            <Scale width={18} height={18} className="text-slate shrink-0 mt-0.5" />
            <p className="text-[13px] text-slate leading-relaxed">
              Reputation is weighted by <span className="font-semibold">distinct verified counterparties</span>,
              not raw trade count. Pi's one-person-one-account verification makes fake reviews and farming pointless.
            </p>
          </div>
        </div>

        <Link href="/trust" className="card block p-4 active:scale-[0.99] transition">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center h-10 w-10 rounded-xl bg-brand-soft text-brand-dark shrink-0">
              <Shield width={20} height={20} />
            </span>
            <div className="flex-1">
              <p className="font-semibold text-[15px]">How your money stays safe</p>
              <p className="text-[13px] text-muted">Non-custodial guarantees & contract address</p>
            </div>
            <ArrowRight width={18} height={18} className="text-faint" />
          </div>
        </Link>

        <button onClick={signOut} className="btn-ghost w-full">Sign out</button>
      </main>

      <BottomNav />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-paper p-3.5">
      <p className="font-display text-2xl font-semibold tnum">{value}</p>
      <p className="text-[12px] text-faint mt-0.5">{label}</p>
    </div>
  );
}
