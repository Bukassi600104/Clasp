'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/providers';
import { api, type OwnProfileView } from '@/lib/client-api';
import type { Trade, RatingSummary } from '@/lib/types';
import { isTerminal, microToPi } from '@/lib/escrow';
import { nextTier, tradesToNext, tierProgress, limitLabel } from '@/lib/tiers';
import { AppBar, BottomNav } from '@/components/chrome';
import { Avatar } from '@/components/avatar';
import { DonutRing } from '@/components/donut';
import { TierBadge } from '@/components/tier-badge';
import { FeedbackBadge } from '@/components/feedback';
import { Shield, Scale, ArrowRight, Sliders, TrendingUp, ThumbsUp } from '@/components/icons';

const C = {
  completed: '#0E7A53',
  settled: '#1F5E8C',
  refunded: '#B45309',
  dispute: '#A12D26',
};

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [view, setView] = useState<OwnProfileView | null>(null);

  useEffect(() => { api.myTrades().then(setTrades).catch(() => setTrades([])); }, []);
  useEffect(() => { api.profile().then(setView).catch(() => {}); }, []);

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

        {/* Selling limit + tier ladder */}
        {view && <SellingLimitCard view={view} onSaved={setView} />}

        {/* Reputation — mutual ratings */}
        {view && <ReputationCard view={view} />}

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

/* ── Selling limit (tier ladder + slider) ── */
function SellingLimitCard({ view, onSaved }: { view: OwnProfileView; onSaved: (v: OwnProfileView) => void }) {
  const { stats } = view;
  const qualifying = stats.qualifying;
  const ceilingMicro = stats.tier.ceiling_micro;                 // string | null
  const ceilingPi = ceilingMicro === null ? null : microToPi(BigInt(ceilingMicro));
  const effectivePi = view.effective_limit_micro === null ? null : microToPi(BigInt(view.effective_limit_micro));
  const next = nextTier(qualifying);
  const toNext = tradesToNext(qualifying);
  const pct = Math.round(tierProgress(qualifying) * 100);

  const isElite = ceilingPi === null;
  const sliderMax = ceilingPi ?? 10000;
  const step = Math.max(1, Math.round(sliderMax / 100));

  const [unlimited, setUnlimited] = useState(effectivePi === null);
  const [value, setValue] = useState<number>(effectivePi ?? sliderMax);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const curMicro = view.effective_limit_micro;
  const dirty = unlimited
    ? curMicro !== null
    : curMicro === null || Math.abs(microToPi(BigInt(curMicro)) - value) > 1e-9;

  async function save() {
    setBusy(true); setErr(null); setSaved(false);
    try {
      const v = await api.setLimit(unlimited ? null : value);
      onSaved(v);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update your limit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold flex items-center gap-2">
          <Sliders width={18} height={18} className="text-brand" /> Selling limit
        </h2>
        <TierBadge name={stats.tier.name} tone={stats.tier.tone} className="!py-0.5 !px-2" />
      </div>

      {/* Current saved cap */}
      <div className="mt-4 rounded-xl bg-paper p-4 text-center">
        <p className="text-[12px] text-faint">Your cap per trade</p>
        <p className="font-display text-[32px] leading-none font-semibold tnum mt-1">
          {limitLabel(view.effective_limit_micro === null ? null : BigInt(view.effective_limit_micro))}
        </p>
      </div>

      {/* Tier progress */}
      <div className="mt-4">
        {next ? (
          <>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted">
                <span className="font-semibold text-ink tnum">{qualifying}</span> clean trade{qualifying === 1 ? '' : 's'}
              </span>
              <span className="text-faint flex items-center gap-1">
                <TrendingUp width={14} height={14} />
                <span className="tnum">{toNext}</span> more → {next.name} ({limitLabel(next.ceilingMicro ?? null)})
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-paper overflow-hidden">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(4, pct)}%` }} />
            </div>
          </>
        ) : (
          <p className="text-[13px] text-brand-dark font-semibold flex items-center gap-1.5">
            <TrendingUp width={15} height={15} /> Top tier reached — you can sell with no per-trade cap.
          </p>
        )}
      </div>

      {/* Cap control */}
      <div className="mt-5">
        <p className="text-[13px] text-muted leading-relaxed">
          Set your per-trade cap anywhere up to your earned ceiling of{' '}
          <span className="font-semibold text-ink">{limitLabel(ceilingMicro === null ? null : BigInt(ceilingMicro))}</span>.
          Crossing a milestone unlocks a higher ceiling — you choose when to raise the cap.
        </p>

        {isElite && (
          <label className="mt-3 flex items-center justify-between rounded-xl bg-paper px-4 py-3">
            <span className="text-[14px] font-medium text-ink">No limit (unlimited)</span>
            <input
              type="checkbox"
              checked={unlimited}
              onChange={(e) => setUnlimited(e.target.checked)}
              className="h-5 w-5 accent-brand"
            />
          </label>
        )}

        {!unlimited && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] text-faint">Per-trade cap</span>
              <span className="text-[15px] font-semibold tnum">{value.toLocaleString()} π</span>
            </div>
            <input
              type="range"
              min={1}
              max={sliderMax}
              step={step}
              value={value}
              onChange={(e) => { setValue(Number(e.target.value)); setSaved(false); }}
              className="w-full accent-brand"
              aria-label="Per-trade cap"
            />
            <div className="flex justify-between text-[11px] text-faint mt-1">
              <span>1 π</span>
              <span>{sliderMax.toLocaleString()} π</span>
            </div>
          </div>
        )}

        {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
        {saved && !dirty && <p className="mt-2 text-[13px] text-brand-dark font-medium">Limit saved.</p>}

        <button onClick={save} disabled={busy || !dirty} className="btn-primary w-full mt-4">
          {busy ? 'Saving…' : 'Save limit'}
        </button>
      </div>
    </div>
  );
}

/* ── Reputation (mutual ratings) ── */
function ReputationCard({ view }: { view: OwnProfileView }) {
  const { stats, reviews } = view;
  return (
    <div className="card p-5">
      <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
        <ThumbsUp width={18} height={18} className="text-brand" /> Your reputation
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <RatingStat label="As a seller" summary={stats.seller_rating} />
        <RatingStat label="As a buyer" summary={stats.buyer_rating} />
      </div>

      {reviews.length > 0 && (
        <>
          <div className="hr my-4" />
          <h3 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-3">Recent reviews</h3>
          <ul className="space-y-3.5">
            {reviews.map((r) => (
              <li key={r.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] font-medium text-ink truncate">
                    @{r.rater_username ?? 'pioneer'}{' '}
                    <span className="text-faint font-normal">· you as {r.ratee_role}</span>
                  </span>
                  <FeedbackBadge positive={r.positive} size={14} />
                </div>
                {r.comment && <p className="text-[13px] text-muted mt-1 leading-snug">“{r.comment}”</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RatingStat({ label, summary }: { label: string; summary: RatingSummary }) {
  const good = (summary.positivePct ?? 0) >= 80;
  return (
    <div className="rounded-xl bg-paper p-3.5">
      <p className="text-[12px] text-faint">{label}</p>
      {summary.count > 0 && summary.positivePct != null ? (
        <>
          <div className="mt-1 flex items-center gap-1.5">
            <ThumbsUp width={18} height={18} className={good ? 'text-brand' : 'text-warn'} />
            <span className="font-display text-2xl font-semibold tnum">{summary.positivePct}%</span>
          </div>
          <p className="text-[11px] text-faint mt-0.5">positive · {summary.count} rating{summary.count === 1 ? '' : 's'}</p>
        </>
      ) : (
        <p className="mt-1.5 text-[13px] text-faint">No ratings yet</p>
      )}
    </div>
  );
}
