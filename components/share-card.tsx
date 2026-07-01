'use client';

import { useState } from 'react';
import type { Trade } from '@/lib/types';
import { formatPi } from '@/lib/format';
import { sharePayLink } from '@/lib/pi-client';
import { Share, Copy, Check } from './icons';

/** Shown to the seller while a trade is awaiting funding. */
export function ShareCard({ trade }: { trade: Trade }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/t/${trade.id}` : '';
  const message = `Pay safely via escrow — funds release only when you confirm delivery. ${formatPi(trade.amount_micro)} for "${trade.memo}".`;

  async function copy() {
    await navigator.clipboard?.writeText(`${message}\n${url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="card p-5 bg-sink ring-0">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-white/55">
        Share this link to get paid
      </p>
      <p className="mt-2 text-[14px] text-white/80 leading-relaxed">
        Send it wherever you already sell. Every buyer sees a safe checkout — not your wallet.
      </p>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/10 px-3.5 h-12">
        <span className="flex-1 truncate text-[13px] text-white/85 tnum">{url}</span>
        <button onClick={copy} className="shrink-0 grid place-items-center h-8 w-8 rounded-lg bg-white/15 text-white active:scale-95">
          {copied ? <Check width={16} height={16} /> : <Copy width={16} height={16} />}
        </button>
      </div>

      <button
        onClick={() => sharePayLink('Pay safely via Clasp', message, url)}
        className="btn bg-brand text-brand-ink w-full mt-3 hover:bg-brand-dark shadow-glow"
      >
        <Share width={18} height={18} /> Share payment link
      </button>
    </div>
  );
}
