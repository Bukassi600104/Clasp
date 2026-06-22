import { formatPi } from '@/lib/format';
import { PiSymbol } from './icons';

/** A single label/amount row. */
export function MoneyRow({
  label,
  micro,
  emphasis = false,
  sub,
  sign,
}: {
  label: string;
  micro: string | bigint;
  emphasis?: boolean;
  sub?: string;
  sign?: '+' | '-';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className={emphasis ? 'font-semibold text-ink' : 'text-muted text-[15px]'}>
          {label}
        </div>
        {sub && <div className="text-[12px] text-faint mt-0.5">{sub}</div>}
      </div>
      <div
        className={`tnum whitespace-nowrap ${
          emphasis ? 'font-display text-xl font-semibold text-ink' : 'text-[15px] text-ink'
        }`}
      >
        {sign && <span className={sign === '+' ? 'text-brand' : 'text-muted'}>{sign} </span>}
        {formatPi(micro)}
      </div>
    </div>
  );
}

/** Big hero amount, e.g. on checkout. */
export function HeroAmount({ micro, caption }: { micro: string | bigint; caption?: string }) {
  return (
    <div className="text-center py-2">
      <div className="inline-flex items-center gap-2">
        <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-soft text-brand-dark">
          <PiSymbol width={18} height={18} strokeWidth={2} />
        </span>
        <span className="font-display text-[44px] leading-none font-semibold tracking-tight tnum">
          {formatPi(micro, { symbol: false })}
        </span>
        <span className="font-display text-2xl text-muted">π</span>
      </div>
      {caption && <div className="text-[13px] text-faint mt-2">{caption}</div>}
    </div>
  );
}
