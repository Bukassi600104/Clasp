'use client';

import { useEffect, useState } from 'react';
import { countdown, isUrgent } from '@/lib/format';
import { Clock } from './icons';

/** Live-ticking deadline countdown. Turns clay-red under 2 hours. */
export function Countdown({
  deadline,
  label,
  className = '',
  light = false,
}: {
  deadline: string | null;
  label?: string;
  className?: string;
  light?: boolean;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  if (!deadline) return null;
  const urgent = isUrgent(deadline);
  const color = light
    ? urgent ? 'text-white' : 'text-white/75'
    : urgent ? 'text-danger' : 'text-muted';
  return (
    <span
      className={`inline-flex items-center gap-1.5 tnum text-[13px] font-semibold ${color} ${className}`}
    >
      <Clock width={14} height={14} />
      {label ? `${label} ` : ''}
      {countdown(deadline)}
    </span>
  );
}
