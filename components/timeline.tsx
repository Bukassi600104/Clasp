import type { Trade } from '@/lib/types';
import type { TradeState } from '@/lib/escrow';
import { Check } from './icons';

/**
 * Linear progress of the happy path, with branch labels for terminal
 * off-paths (refunded / cancelled / disputed / nuclear).
 */
const HAPPY: { state: TradeState; label: string }[] = [
  { state: 'CREATED', label: 'Trade created' },
  { state: 'FUNDED', label: 'Funds locked' },
  { state: 'SHIPPED', label: 'Shipped' },
  { state: 'COMPLETED', label: 'Completed' },
];

const ORDER: Record<TradeState, number> = {
  CREATED: 0, FUNDED: 1, SHIPPED: 2, DISPUTED: 2, COMPLETED: 3,
  SETTLED: 3, REFUNDED: 1, NUCLEAR: 3, CANCELLED: 0,
};

export function Timeline({ trade }: { trade: Trade }) {
  const reached = ORDER[trade.state];
  const offPath =
    trade.state === 'REFUNDED' ? 'Auto-refunded — seller no-show' :
    trade.state === 'CANCELLED' ? 'Cancelled before funding' :
    trade.state === 'DISPUTED' ? 'In dispute — settling' :
    trade.state === 'SETTLED' ? 'Settled by agreement' :
    trade.state === 'NUCLEAR' ? 'Nuclear — bonds burned, split 50/50' : null;

  return (
    <div className="card p-5">
      <ol className="relative">
        {HAPPY.map((step, i) => {
          const stepOrder = ORDER[step.state];
          const isCurrent = trade.state === step.state;
          const isPast = reached > stepOrder;
          const reachedThis = isPast || isCurrent;
          const last = i === HAPPY.length - 1;
          return (
            <li key={step.state} className="flex gap-3.5 pb-5 last:pb-0 relative">
              {!last && (
                <span
                  className={`absolute left-[13px] top-7 bottom-0 w-0.5 ${
                    isPast ? 'bg-brand' : 'bg-line'
                  }`}
                />
              )}
              <span
                className={`relative z-10 grid place-items-center h-[26px] w-[26px] rounded-full shrink-0 ${
                  isPast
                    ? 'bg-brand text-white'
                    : isCurrent
                      ? 'bg-sink text-white ring-4 ring-sink/10'
                      : 'bg-surface ring-1 ring-line text-faint'
                }`}
              >
                {isPast ? (
                  <Check width={15} height={15} strokeWidth={2.4} />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </span>
              <div className="pt-0.5">
                <p className={`text-[15px] font-semibold ${reachedThis ? 'text-ink' : 'text-faint'}`}>
                  {step.label}
                </p>
                {isCurrent && step.state !== 'COMPLETED' && (
                  <p className="text-[12px] text-muted mt-0.5">In progress</p>
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
        </div>
      )}
    </div>
  );
}
