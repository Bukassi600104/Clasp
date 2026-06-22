/**
 * Clasp brand mark — the uploaded logo (emerald squircle + two interlocking
 * links forming a clasp), rendered as a crisp, flat inline SVG. No gradients.
 */
export function ClaspMark({ size = 32, rounded = true }: { size?: number; rounded?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="100" height="100" rx={rounded ? 26 : 0} fill="#0E7A53" />
      {/* left link */}
      <rect x="21" y="37" width="40" height="26" rx="13" fill="none" stroke="#FFFFFF" strokeWidth="7" />
      {/* right link — emerald halo masks the left link beneath, then white stroke,
          producing the clean interlocked "clasp" look */}
      <rect x="39" y="37" width="40" height="26" rx="13" fill="none" stroke="#0E7A53" strokeWidth="13" />
      <rect x="39" y="37" width="40" height="26" rx="13" fill="none" stroke="#FFFFFF" strokeWidth="7" />
    </svg>
  );
}

/** Clasp wordmark + brand mark. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 40 : size === 'sm' ? 28 : 34;
  const text = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-lg';
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="inline-flex shadow-card"
        style={{ borderRadius: dim * 0.26 }}
      >
        <ClaspMark size={dim} />
      </span>
      <span className={`font-display ${text} font-semibold tracking-tight text-ink`}>
        Clasp
      </span>
    </div>
  );
}
