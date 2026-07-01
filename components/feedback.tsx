'use client';

import { ThumbsUp, ThumbsDown } from './icons';
import type { RatingSummary } from '@/lib/types';

/** Compact "👍 96% (24)" summary, or a muted "No ratings yet". */
export function FeedbackPill({ summary, size = 15 }: { summary: RatingSummary; size?: number }) {
  if (!summary.count || summary.positivePct == null) {
    return <span className="text-[12px] text-faint">No ratings yet</span>;
  }
  const good = summary.positivePct >= 80;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <ThumbsUp width={size} height={size} className={good ? 'text-brand' : 'text-warn'} />
      <span className={`font-semibold tnum ${good ? 'text-brand-dark' : 'text-warn'}`}>{summary.positivePct}%</span>
      <span className="text-faint tnum">({summary.count})</span>
    </span>
  );
}

/** Single-rating chip: a 👍 or 👎 with its label. */
export function FeedbackBadge({ positive, size = 16 }: { positive: boolean; size?: number }) {
  return positive ? (
    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-dark">
      <ThumbsUp width={size} height={size} className="text-brand" /> Positive
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-warn">
      <ThumbsDown width={size} height={size} className="text-warn" /> Negative
    </span>
  );
}

/** Interactive 👍 / 👎 picker for leaving feedback. value: true / false / null. */
export function FeedbackPicker({
  value, onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const opt = (isPos: boolean) => {
    const active = value === isPos;
    const tone = isPos
      ? (active ? 'bg-brand text-brand-ink ring-brand' : 'bg-surface text-brand-dark ring-line')
      : (active ? 'bg-warn text-sink ring-warn' : 'bg-surface text-muted ring-line');
    const Icon = isPos ? ThumbsUp : ThumbsDown;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={isPos ? 'Positive' : 'Negative'}
        onClick={() => onChange(isPos)}
        className={`flex-1 h-12 rounded-xl ring-1 font-semibold text-[14px] flex items-center justify-center gap-2 transition active:scale-95 ${tone}`}
      >
        <Icon width={18} height={18} /> {isPos ? 'Positive' : 'Negative'}
      </button>
    );
  };
  return (
    <div className="flex items-center gap-3" role="radiogroup" aria-label="Your feedback">
      {opt(true)}
      {opt(false)}
    </div>
  );
}
