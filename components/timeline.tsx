import type { Trade, TradeEvent } from '@/lib/types';
import type { TradeState } from '@/lib/escrow';
import { formatDate } from '@/lib/format';
import { Check } from './icons';

/**
 * Trade tracking timeline. Every reached node shows when it happened and who
 * caused it (pulled from the event log); the current node pulses. Terminal
 * off-paths (refund, cancel, dispute, nuclear) get a labelled branch row.
 */
const HAPPY: { state: TradeState; label: string; event: string }[] = [
  { state: 'CREATED', label: 'Trade created', event: 'trade.created' },
  { state: 'FUNDED', label: 'Funds locked in escrow', event: 'trade.funded' },
  { state: 'SHIPPED', label: 'Shipped', event: 'trade.shipped' },
  { state: 'COMPLETED', label: 'Completed', event: 'trade.completed' },
];

const ORDER: Record<TradeState, number> = {
  CREATED: 0, FUNDED: 1, SHIPPED: 2, DISPUTED: 2, COMPLETED: 3,
  SETTLED: 3, REFUNDED: 1, NUCLEAR: 3, CANCELLED: 0,
};

/** Short human line for who moved the trade at this node. */
function actorLine(trade: Trade, event: TradeEvent | undefined): string | null {
  if (!event) return null;
  switch (event.event) {
    case 'trade.created': return trade.seller_username ? `by @${trade.seller_username}` : null;
    case 'trade.funded': return trade.buyer_username ? `by @${trade.buyer_username}` : null;
    case 'trade.shipped': return trade.seller_username ? `by @${trade.seller_username}` : null;
    case 'trade.completed':
      return event.payload?.reason === 'silence'
        ? 'released automatically'
        : trade.buyer_username ? `confirmed by @${trade.buyer_username}` : null;
    default: return null;
  }
}

export function Timeline({ trade, events = [] }: { trade: Trade; events?: TradeEvent[] }) {
  const reached = ORDER[trade.state];
  const eventFor = (name: string) => events.find((e) => e.event === name);
  const offPath =
    trade.state === 'REFUNDED' ? 'Refunded in full. The seller missed the ship window.' :
    trade.state === 'CANCELLED' ? 'Cancelled before funding.' :
    trade.state === 'DISPUTED' ? 'In dispute. Both sides are settling.' :
    trade.state === 'SETTLED' ? 'Settled by agreement.' :
    trade.state === 'NUCLEAR' ? 'No settlement in time. Bonds burned, principal split 50/50.' : null;
  const offPathEvent =
    trade.state === 'REFUNDED' ? eventFor('trade.refunded') :
    trade.state === 'CANCELLED' ? eventFor('trade.cancelled') :
    trade.state === 'DISPUTED' ? eventFor('trade.disputed') :
    trade.state === 'SETTLED' ? eventFor('trade.settled') :
    trade.state === 'NUCLEAR' ? eventFor('trade.nuclear') : undefined;

  return (
    <div className="card p-5">
      <h3 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-4">Tracking</h3>
      <ol className="relative">
        {HAPPY.map((step, i) => {
          const stepOrder = ORDER[step.state];
          const isCurrent = trade.state === step.state;
          const isPast = reached > stepOrder;
          const reachedThis = isPast || isCurrent;
          const last = i === HAPPY.length - 1;
          const ev = reachedThis ? eventFor(step.event) : undefined;
          const actor = reachedThis ? actorLine(trade, ev) : null;
          return (
            <li key={step.state} className="flex gap-3.5 pb-5 last:pb-0 relative">
              {!last && (
                <span
                  className={`absolute left-[13px] top-7 bottom-0 w-0.5 ${
                    isPast ? 'bg-brand shadow-glow' : 'bg-line'
                  }`}
                />
              )}
              <span
                className={`relative z-10 grid place-items-center h-[26px] w-[26px] rounded-full shrink-0 ${
                  isPast
                    ? 'bg-brand text-brand-ink shadow-glow'
                    : isCurrent
                      ? 'bg-brand-soft text-brand ring-1 ring-brand/50'
                      : 'bg-surface ring-1 ring-line text-faint'
                }`}
              >
                {isPast ? (
                  <Check width={15} height={15} strokeWidth={2.4} />
                ) : (
                  <span className={`h-1.5 w-1.5 rounded-full bg-current ${isCurrent ? 'animate-pulse-dot' : ''}`} />
                )}
              </span>
              <div className="pt-0.5 min-w-0">
                <p className={`text-[15px] font-semibold ${reachedThis ? 'text-ink' : 'text-faint'}`}>
                  {step.label}
                </p>
                {ev && (
                  <p className="text-[12px] text-faint mt-0.5 tnum">
                    {formatDate(ev.confirmed_at)}{actor ? ` · ${actor}` : ''}
                  </p>
                )}
                {isCurrent && step.state !== 'COMPLETED' && !ev && (
                  <p className="text-[12px] text-brand mt-0.5">In progress</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {offPath && (
        <div className="mt-1 pt-4 border-t border-line">
          <p className={`text-[14px] font-semibold ${
            trade.state === 'NUCLEAR' ? 'text-danger' :
            trade.state === 'DISPUTED' ? 'text-warn' : 'text-info'
          }`}>
            {offPath}
          </p>
          {offPathEvent && (
            <p className="text-[12px] text-faint mt-0.5 tnum">{formatDate(offPathEvent.confirmed_at)}</p>
          )}
        </div>
      )}
    </div>
  );
}
