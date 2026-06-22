'use client';

import Link from 'next/link';
import type { Trade } from '@/lib/types';
import { formatPi } from '@/lib/format';
import { StateBadge } from './state-badge';
import { Countdown } from './countdown';
import { Lock, Eye, EyeOff } from './icons';

function meta(trade: Trade, role: 'seller' | 'buyer') {
  switch (trade.state) {
    case 'CREATED':
      return { label: 'Awaiting payment', deadlineLabel: 'Fund by', deadline: trade.funding_deadline };
    case 'FUNDED':
      return { label: 'Locked in escrow', deadlineLabel: 'Ship by', deadline: trade.ship_deadline };
    case 'SHIPPED':
      return { label: 'Locked in escrow', deadlineLabel: 'Releases', deadline: trade.inspect_deadline };
    case 'DISPUTED':
      return { label: 'In dispute', deadlineLabel: 'Settle by', deadline: trade.settlement_deadline };
    default:
      return { label: 'Closed', deadlineLabel: '', deadline: null };
  }
}

export function HeroTradeCard({
  trade,
  role,
  hidden,
  onToggle,
}: {
  trade: Trade;
  role: 'seller' | 'buyer';
  hidden: boolean;
  onToggle: () => void;
}) {
  const m = meta(trade, role);
  const counterparty =
    role === 'seller' ? trade.buyer_username : trade.seller_username;
  const href =
    trade.state === 'CREATED' && role === 'buyer' ? `/t/${trade.id}` : `/trade/${trade.id}`;

  return (
    <div className="snap-start shrink-0 w-[86%] first:ml-5 last:mr-5">
      <Link
        href={href}
        className="card block p-5 rounded-3xl active:scale-[0.99] transition hover:shadow-lift"
      >
        {/* Top row — state pill (left) + brand glyph (right), like flag + network logo */}
        <div className="flex items-center justify-between">
          <StateBadge state={trade.state} />
          <span className="grid place-items-center h-7 w-7 rounded-lg bg-paper text-muted">
            <Lock width={16} height={16} />
          </span>
        </div>

        {/* Balance block */}
        <p className="mt-5 text-[13px] text-faint">{m.label}</p>
        <div className="mt-1 flex items-center gap-2.5">
          <span className="font-display text-[34px] leading-none font-semibold tnum">
            {hidden ? '••••••' : formatPi(trade.amount_micro)}
          </span>
          <button
            onClick={(e) => { e.preventDefault(); onToggle(); }}
            aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
            className="text-faint hover:text-muted p-1 -m-1"
          >
            {hidden ? <EyeOff width={18} height={18} /> : <Eye width={18} height={18} />}
          </button>
        </div>

        <p className="mt-3 text-[13px] text-muted truncate">{trade.memo}</p>

        {/* Bottom meta row — counterparty (left) + deadline (right) */}
        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="text-[11px] text-faint uppercase tracking-wide">
              {role === 'seller' ? 'Buyer' : 'Seller'}
            </p>
            <p className="text-[13px] font-medium text-ink">
              {counterparty ? `@${counterparty}` : 'Not yet funded'}
            </p>
          </div>
          {m.deadline && (
            <div className="text-right">
              <p className="text-[11px] text-faint uppercase tracking-wide">{m.deadlineLabel}</p>
              <Countdown deadline={m.deadline} className="!text-[13px]" />
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}
