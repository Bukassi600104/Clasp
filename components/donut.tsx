/**
 * Flat donut ring — solid color segments only (no gradients). Used for the
 * trust portfolio. Segments render clockwise from the top with small gaps.
 */
export interface DonutSegment {
  value: number;
  color: string;
  label?: string;
}

export function DonutRing({
  segments,
  size = 196,
  stroke = 20,
  children,
}: {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const gap = total > 0 ? 4 : 0;
  let offset = 0;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ECEDF1" strokeWidth={stroke} />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s, i) => {
              const len = (s.value / total) * C;
              const dash = `${Math.max(0.001, len - gap)} ${C}`;
              const el = (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="round"
                />
              );
              offset += len;
              return el;
            })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
