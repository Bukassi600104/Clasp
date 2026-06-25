import { Shield } from './icons';

/** Flat, single-color tier pill (no gradients). Tone comes from the tier model. */
const TONE: Record<string, string> = {
  slate: 'bg-slate-soft text-slate',
  brand: 'bg-brand-soft text-brand-dark',
  info: 'bg-info-soft text-info',
  premium: 'bg-sink text-white',
};

export function TierBadge({
  name, tone, className = '',
}: {
  name: string;
  tone: string;
  className?: string;
}) {
  return (
    <span className={`chip ${TONE[tone] ?? TONE.slate} ${className}`}>
      <Shield width={12} height={12} /> {name}
    </span>
  );
}
