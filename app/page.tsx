'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from './providers';
import { api } from '@/lib/client-api';
import type { Trade } from '@/lib/types';
import { isTerminal } from '@/lib/escrow';
import { formatPi } from '@/lib/format';
import { Logo } from '@/components/brand';
import { BottomNav } from '@/components/chrome';
import { Avatar } from '@/components/avatar';
import { TradeRow } from '@/components/trade-row';
import { OpenLinkSheet } from '@/components/open-link-sheet';
import { Lock, Shield, Scale, Plus, Bell, ArrowRight, Spark, ArrowUpRight, ArrowDownLeft, Check } from '@/components/icons';

export default function HomePage() {
  const { user, loading } = useAuth();
  if (loading) return <BootSplash />;
  return user ? <Dashboard /> : <Landing />;
}

function BootSplash() {
  return (
    <div className="min-h-[100dvh] grid place-items-center">
      <div className="animate-pulse">
        <Logo size="lg" />
      </div>
    </div>
  );
}

/* ───────────────────────────── Signed-out ───────────────────────────── */

function Landing() {
  const { signIn, signingIn, error, inPiBrowser } = useAuth();

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <div className="px-5 pt-6">
        <Logo />
      </div>

      <div className="px-5 pt-10 flex-1">
        <span className="chip bg-brand-soft text-brand-dark">
          <Shield width={14} height={14} /> Non-custodial escrow on Pi
        </span>
        <h1 className="mt-5 font-display text-[34px] leading-[1.08] font-semibold tracking-tight">
          Sell anywhere.<br />Get paid safely.
        </h1>
        <p className="mt-4 text-[16px] leading-relaxed text-muted">
          Your Pi locks in a smart contract and releases only when delivery is
          confirmed. Nobody holds the money but the blockchain — not even us.
        </p>

        <div className="mt-8 space-y-3">
          <TrustPoint Icon={Lock} title="Funds locked, not held"
            body="Payment sits inside the contract. The seller can't touch it until you confirm." />
          <TrustPoint Icon={Scale} title="No human judges, ever"
            body="Disputes resolve by incentive design and on-chain settlement — never an operator's opinion." />
          <TrustPoint Icon={Spark} title="A no-show means an automatic refund"
            body="If the seller never ships, the contract returns your Pi and bond in full." />
        </div>
      </div>

      <div className="sticky bottom-0 px-5 pt-4 pb-[max(env(safe-area-inset-bottom),18px)] bg-paper/90 backdrop-blur-md">
        <div className="hr mb-4" />
        <button onClick={signIn} disabled={signingIn} className="btn-primary w-full">
          {signingIn ? 'Connecting…' : 'Sign in with Pi'}
        </button>
        {!inPiBrowser && (
          <p className="mt-3 text-center text-[13px] text-faint">
            Open this app in the <span className="font-semibold text-muted">Pi Browser</span> to sign in.
          </p>
        )}
        {error && <p className="mt-3 text-center text-[13px] text-danger">{error}</p>}
        <p className="mt-3 text-center text-[12px] text-faint">
          Pi authentication only. We never see your keys or passphrase.{' '}
          <Link href="/trust" className="text-brand-dark font-semibold underline-offset-2 hover:underline">
            How it works
          </Link>
        </p>
        <p className="mt-2 text-center text-[12px] text-faint">
          <Link href="/privacy" className="hover:text-muted underline-offset-2 hover:underline">Privacy</Link>
          {' · '}
          <Link href="/terms" className="hover:text-muted underline-offset-2 hover:underline">Terms</Link>
          {' · '}
          <a href="https://github.com/Bukassi600104/Clasp" target="_blank" rel="noreferrer" className="hover:text-muted underline-offset-2 hover:underline">Source</a>
        </p>
      </div>
    </div>
  );
}

function TrustPoint({ Icon, title, body }: { Icon: typeof Lock; title: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl bg-surface ring-1 ring-line text-brand">
        <Icon width={20} height={20} />
      </span>
      <div>
        <h3 className="font-semibold text-[15px] text-ink">{title}</h3>
        <p className="text-[14px] text-muted leading-snug mt-0.5">{body}</p>
      </div>
    </div>
  );
}

/* ───────────────────────────── Signed-in ───────────────────────────── */

function Dashboard() {
  const { user, unread } = useAuth();
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openLink, setOpenLink] = useState(false);

  useEffect(() => {
    api.myTrades().then(setTrades).catch((e) => setErr(e.message));
  }, []);

  const roleOf = (t: Trade): 'seller' | 'buyer' => (t.seller_uid === user?.uid ? 'seller' : 'buyer');
  const list = trades ?? [];
  const active = list.filter((t) => !isTerminal(t.state));
  const successful = list.filter((t) => t.state === 'COMPLETED' || t.state === 'SETTLED').length;
  const inEscrow = active.reduce((s, t) => s + BigInt(t.amount_micro), 0n);
  const selling = active.filter((t) => roleOf(t) === 'seller');
  const buying = active.filter((t) => roleOf(t) === 'buyer');
  const sellingValue = selling.reduce((s, t) => s + BigInt(t.amount_micro), 0n);
  const buyingValue = buying.reduce((s, t) => s + BigInt(t.amount_micro), 0n);
  const recent = list.slice(0, 6);

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header — avatar + welcome + bell */}
      <header className="px-5 pt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={user?.username ?? '@'} size={44} />
          <div>
            <p className="text-[13px] text-muted leading-tight">Welcome back,</p>
            <p className="font-display text-[18px] font-semibold tracking-tight leading-tight">
              @{user?.username}
            </p>
          </div>
        </div>
        <Link href="/notifications" aria-label="Activity"
          className="relative grid place-items-center h-11 w-11 rounded-full ring-1 ring-line bg-surface shadow-card">
          <Bell width={20} height={20} />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-surface" />
          )}
        </Link>
      </header>

      {/* Hero summary — Pi protected in escrow right now */}
      <div className="px-5 pt-5">
        <div className="card p-5 rounded-3xl bg-sink ring-0 text-white shadow-lift">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-white/55">In escrow now</p>
            {successful > 0 && (
              <span className="chip bg-white/10 text-white !py-1">
                <Check width={13} height={13} /> {successful} safe trade{successful === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="mt-1.5 font-display text-[36px] leading-none font-semibold tnum">
            {trades ? formatPi(inEscrow) : '—'}
          </p>
          <p className="mt-2 text-[12.5px] text-white/55 leading-relaxed">
            {active.length === 0
              ? 'Nothing locked right now — funds are only ever held by the contract, never us.'
              : `${active.length} active trade${active.length === 1 ? '' : 's'} protected by the contract.`}
          </p>
        </div>
      </div>

      {/* Selling / Buying */}
      <div className="px-5 pt-3 grid grid-cols-2 gap-3">
        <StatCard Icon={ArrowUpRight} tone="brand" label="Selling" count={selling.length} value={sellingValue} />
        <StatCard Icon={ArrowDownLeft} tone="info" label="Buying" count={buying.length} value={buyingValue} />
      </div>

      {/* Action row — Open link · New trade · quick + */}
      <div className="px-5 pt-4 flex items-center gap-3">
        <button onClick={() => setOpenLink(true)} className="btn bg-surface text-ink shadow-card flex-1 h-12 gap-2">
          <ArrowDownLeft width={18} height={18} /> Open link
        </button>
        <Link href="/create" className="btn bg-surface text-ink shadow-card flex-1 h-12 gap-2">
          <ArrowUpRight width={18} height={18} /> New trade
        </Link>
        <Link
          href="/create"
          aria-label="New trade"
          className="grid place-items-center h-12 w-12 rounded-full bg-brand text-white shadow-fab active:scale-95 transition shrink-0"
        >
          <Plus width={22} height={22} strokeWidth={2.3} />
        </Link>
      </div>

      {/* Recent activity */}
      <main className="px-5 pt-7 flex-1">
        {err && <p className="text-[14px] text-danger">{err}</p>}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display text-lg font-semibold">Recent activity</h2>
            <Link href="/notifications" className="text-[13px] font-semibold text-brand-dark">
              View all
            </Link>
          </div>
          {!trades && (
            <div className="space-y-2 pt-2">
              {[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-xl bg-paper animate-pulse" />)}
            </div>
          )}
          {trades && recent.length === 0 && (
            <p className="py-6 text-center text-[14px] text-muted">
              No trades yet. Tap <span className="font-semibold text-ink">New trade</span> to create your first safe deal.
            </p>
          )}
          <ul className="divide-y divide-line">
            {recent.map((t) => (
              <li key={t.id}>
                <TradeRow trade={t} role={roleOf(t)} />
              </li>
            ))}
          </ul>
        </div>
      </main>

      <div className="h-6" />
      <BottomNav />

      {openLink && <OpenLinkSheet onClose={() => setOpenLink(false)} />}
    </div>
  );
}

function StatCard({
  Icon, tone, label, count, value,
}: {
  Icon: typeof ArrowUpRight;
  tone: 'brand' | 'info';
  label: string;
  count: number;
  value: bigint;
}) {
  const toneCls = tone === 'brand' ? 'bg-brand-soft text-brand-dark' : 'bg-info-soft text-info';
  return (
    <div className="card p-4">
      <span className={`grid place-items-center h-9 w-9 rounded-xl ${toneCls}`}>
        <Icon width={18} height={18} />
      </span>
      <p className="text-[12px] text-faint mt-3">{label}</p>
      <p className="font-display text-[22px] font-semibold tnum mt-0.5 leading-none">{formatPi(value)}</p>
      <p className="text-[11px] text-faint mt-1">{count} active</p>
    </div>
  );
}
