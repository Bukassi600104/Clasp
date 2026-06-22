/** Initials avatar on a solid dark disc (no photo, no gradient). */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const clean = name.replace(/^@/, '');
  const initials = clean.slice(0, 2).toUpperCase();
  return (
    <span
      className="grid place-items-center rounded-full bg-sink text-white font-semibold shrink-0 ring-1 ring-line"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
