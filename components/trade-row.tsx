'use client';

import Link from 'next/link';
import type { Trade } from '@/lib/types';
import { formatPi } from '@/lib/format';
import { isTerminal } from '@/lib/escrow';
import { ArrowUpRight, ArrowDownLeft } from './icons';

const STATE_LABEL: Record<string, string> = {
  CREATED: 'Awaiting payment',
  FUNDED: 'Funds locked',
  SHIPPED: 'Shipped — inspecting',
  DISPUTED: 'In dispute',
  COMPLETED: 'Completed',
  SETTLED: 'Settled',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
  NUCLEAR: 'Nuclear',
};

/** Minimal list row matching the reference "Transaction" rows. */
export function TradeRow({ trade, role }: { trade: Trade; role: 'seller' | 'buyer' }) {
  const href =
    trade.state === 'CREATED' && role === 'buyer' ? `/t/${trade.id}` : `/trade/${trade.id}`;
  const Icon = role === 'seller' ? ArrowUpRight : ArrowDownLeft;
  const done = isTerminal(trade.state);
  const positive = trade.state === 'COMPLETED' || trade.state === 'SETTLED';

  return (
    <Link href={href} className="flex items-center gap-3.5 py-3 active:opacity-70 transition">
      <span className="grid place-items-center h-11 w-11 rounded-full bg-paper text-muted shrink-0">
        <Icon width={19} height={19} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-ink truncate">{trade.memo}</p>
        <p className="text-[12.5px] text-faint">{STATE_LABEL[trade.state]}</p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-[15px] font-semibold tnum ${
          done ? (positive ? 'text-brand' : 'text-muted') : 'text-ink'
        }`}>
          {role === 'seller' ? '' : ''}{formatPi(trade.amount_micro)}
        </p>
        <p className="text-[11px] text-faint">{role === 'seller' ? 'Selling' : 'Buying'}</p>
      </div>
    </Link>
  );
}
