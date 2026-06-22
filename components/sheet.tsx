'use client';

/** Generic bottom sheet with a scrim and grab handle. */
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/40 animate-fade-up" />
      <div
        className="relative w-full max-w-app bg-paper rounded-t-3xl p-5 pb-[max(env(safe-area-inset-bottom),20px)] animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />
        <h2 className="font-display text-xl font-semibold mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}
