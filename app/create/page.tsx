'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppBar } from '@/components/chrome';
import { MoneyRow } from '@/components/money';
import { TierBadge } from '@/components/tier-badge';
import { api } from '@/lib/client-api';
import { PARAMS, piToMicro, bondFor, feeFor, microToPi } from '@/lib/escrow';
import { limitLabel } from '@/lib/tiers';
import { Shield, Truck, Clock, Info, TrendingUp } from '@/components/icons';

const SHIP_OPTIONS = [
  { label: '24 hours', s: 24 * 3600 },
  { label: '3 days', s: 72 * 3600 },
  { label: '7 days', s: 7 * 24 * 3600 },
  { label: '14 days', s: 14 * 24 * 3600 },
];
const INSPECT_OPTIONS = [
  { label: '24 hours', s: 24 * 3600 },
  { label: '3 days', s: 72 * 3600 },
  { label: '7 days', s: 7 * 24 * 3600 },
];

export default function CreatePage() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [shipWindowS, setShip] = useState(PARAMS.SHIP_DEFAULT_S);
  const [inspectWindowS, setInspect] = useState(PARAMS.INSPECT_DEFAULT_S);
  const [feePayer, setFeePayer] = useState<'seller' | 'buyer'>('buyer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Seller's earned per-trade ceiling + tier (replaces the old flat 50π cap).
  const [cap, setCap] = useState<{ micro: bigint | null; tier: { name: string; tone: string } } | null>(null);

  useEffect(() => {
    api.profile()
      .then((p) => setCap({
        micro: p.effective_limit_micro === null ? null : BigInt(p.effective_limit_micro),
        tier: { name: p.stats.tier.name, tone: p.stats.tier.tone },
      }))
      .catch(() => setCap({ micro: PARAMS.AMOUNT_CAP, tier: { name: 'Starter', tone: 'slate' } }));
  }, []);

  const amountNum = parseFloat(amount);
  const amountMicro = !Number.isNaN(amountNum) && amountNum > 0 ? piToMicro(amountNum) : 0n;
  const overCap = !!cap && cap.micro !== null && amountMicro > cap.micro;
  const valid =
    !Number.isNaN(amountNum) &&
    amountNum >= microToPi(PARAMS.AMOUNT_FLOOR) &&
    !overCap &&
    memo.trim().length >= 3;

  const sellerBond = useMemo(() => (amountMicro > 0n ? bondFor(amountMicro) : 0n), [amountMicro]);
  const fee = useMemo(() => (amountMicro > 0n ? feeFor(amountMicro) : 0n), [amountMicro]);
  // What the seller nets on completion: full price if the buyer pays the fee,
  // price − fee if the seller absorbs it.
  const netProceeds = feePayer === 'buyer' ? amountMicro : (amountMicro > fee ? amountMicro - fee : 0n);

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const trade = await api.createTrade({
        amount: amountNum,
        shipWindowS,
        inspectWindowS,
        memo: memo.trim(),
        feePayer,
      });
      router.push(`/trade/${trade.id}?created=1`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the trade.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <AppBar title="Create a safe trade" back />

      <main className="px-5 pt-5 pb-40 space-y-7">
        {/* Amount */}
        <div>
          <label className="label">Amount</label>
          <div className="relative">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              className="field h-16 text-3xl font-display font-semibold tnum pr-12"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-display text-2xl text-muted">π</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[12px] text-faint">
              {cap
                ? `From ${microToPi(PARAMS.AMOUNT_FLOOR)} π up to ${limitLabel(cap.micro)} per trade`
                : 'Loading your limit…'}
            </p>
            {cap && <TierBadge name={cap.tier.name} tone={cap.tier.tone} className="!py-0.5 !px-2 shrink-0" />}
          </div>
          {overCap && cap && (
            <p className="mt-1.5 text-[12px] text-danger flex items-center gap-1.5">
              That’s over your {limitLabel(cap.micro)} per-trade limit.{' '}
              <Link href="/profile" className="inline-flex items-center gap-1 font-semibold text-brand-dark underline-offset-2 hover:underline">
                <TrendingUp width={13} height={13} /> Raise it
              </Link>
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="label">What are you selling?</label>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value.slice(0, 140))}
            placeholder="e.g. Hand-woven Aso-Oke fabric, 2 yards"
            className="field"
          />
          <p className="mt-2 text-[12px] text-faint">{memo.length}/140 — shown to the buyer before they pay.</p>
        </div>

        {/* Ship window */}
        <WindowPicker
          icon={<Truck width={18} height={18} />}
          label="Ship within"
          help="How long you have to send the item after the buyer pays."
          options={SHIP_OPTIONS}
          value={shipWindowS}
          onChange={setShip}
        />

        {/* Inspect window */}
        <WindowPicker
          icon={<Clock width={18} height={18} />}
          label="Buyer inspects within"
          help="After you ship, how long the buyer has to confirm or dispute. Silence releases payment to you."
          options={INSPECT_OPTIONS}
          value={inspectWindowS}
          onChange={setInspect}
        />

        {/* Who pays the platform fee */}
        <div>
          <label className="label">Who pays the 1.5% platform fee?</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { v: 'buyer', label: 'Buyer pays', sub: 'Added on top of the price' },
              { v: 'seller', label: 'I’ll pay it', sub: 'Taken from my proceeds' },
            ] as const).map((o) => {
              const active = feePayer === o.v;
              return (
                <button
                  key={o.v}
                  onClick={() => setFeePayer(o.v)}
                  className={`rounded-xl p-3 text-left transition ring-1 ${
                    active ? 'bg-sink text-white ring-sink' : 'bg-surface text-muted ring-line active:scale-95'
                  }`}
                >
                  <p className="text-[14px] font-semibold">{o.label}</p>
                  <p className={`text-[12px] mt-0.5 ${active ? 'text-white/70' : 'text-faint'}`}>{o.sub}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] text-faint">
            The bond is separate — both you and the buyer always post a refundable security bond.
          </p>
        </div>

        {/* Bond explainer */}
        <div className="card p-4 bg-brand-soft ring-brand/15">
          <div className="flex gap-3">
            <Shield width={20} height={20} className="text-brand-dark shrink-0 mt-0.5" />
            <div className="text-[13px] leading-relaxed text-slate">
              <span className="font-semibold text-brand-dark">You both put down a good-faith bond.</span>{' '}
              You pay a {Number(PARAMS.BOND_PCT)}% seller bond (min {microToPi(PARAMS.BOND_FLOOR)} Pi) when you create this trade.
              It comes back in full when the trade completes — it only ever matters if you walk away.
            </div>
          </div>
        </div>

        {amount && amountMicro > 0n && (
          <div className="card p-4 animate-fade-up">
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-1">
              Your breakdown if this sale completes
            </h3>
            <MoneyRow label="Item price" micro={amountMicro} />
            <div className="hr" />
            <MoneyRow
              label="Platform fee (1.5%)"
              micro={fee}
              sign={feePayer === 'seller' ? '-' : undefined}
              sub={feePayer === 'buyer'
                ? `Min ${microToPi(PARAMS.FEE_MIN)} π · the buyer pays this on top`
                : `Min ${microToPi(PARAMS.FEE_MIN)} π · taken from your proceeds`}
            />
            <div className="hr" />
            <MoneyRow label="You receive" micro={netProceeds} emphasis sub="Plus your bond back on completion" />
            <div className="hr" />
            <MoneyRow label="Your seller bond" micro={sellerBond} sub="Refunded on completion — you pay this now to create" />
          </div>
        )}

        {err && <p className="text-[14px] text-danger">{err}</p>}
      </main>

      <div className="sticky bottom-0 px-5 pt-4 pb-[max(env(safe-area-inset-bottom),18px)] bg-paper/92 backdrop-blur-md">
        <div className="hr mb-4" />
        <button onClick={submit} disabled={!valid || busy} className="btn-primary w-full">
          {busy ? 'Creating…' : 'Create trade & get link'}
        </button>
        <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] text-faint">
          <Info width={13} height={13} /> A 1.5% fee applies only when a sale completes.
        </p>
      </div>
    </div>
  );
}

function WindowPicker({
  icon, label, help, options, value, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  help: string;
  options: { label: string; s: number }[];
  value: number;
  onChange: (s: number) => void;
}) {
  return (
    <div>
      <label className="label flex items-center gap-1.5">{icon} {label}</label>
      <div className="grid grid-cols-4 gap-2">
        {options.map((o) => {
          const active = o.s === value;
          return (
            <button
              key={o.s}
              onClick={() => onChange(o.s)}
              className={`h-11 rounded-xl text-[13px] font-semibold transition ring-1 ${
                active
                  ? 'bg-sink text-white ring-sink'
                  : 'bg-surface text-muted ring-line active:scale-95'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] text-faint">{help}</p>
    </div>
  );
}
