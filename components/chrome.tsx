'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, User, ArrowLeft, Activity, Shield, Plus } from './icons';
import { useAuth } from '@/app/providers';

/** Sticky top bar with optional back button. */
export function AppBar({
  title,
  back = false,
  right,
}: {
  title?: string;
  back?: boolean;
  right?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 bg-paper/85 backdrop-blur-md">
      <div className="flex items-center h-14 px-4 gap-2">
        {back && (
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="grid place-items-center h-9 w-9 -ml-1.5 rounded-full ring-1 ring-line bg-surface active:scale-95 transition"
          >
            <ArrowLeft width={18} height={18} />
          </button>
        )}
        {title && (
          <h1 className="font-display text-[17px] font-semibold tracking-tight truncate">
            {title}
          </h1>
        )}
        <div className="ml-auto">{right}</div>
      </div>
      <div className="hr" />
    </header>
  );
}

const LEFT = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/notifications', label: 'Activity', Icon: Activity },
];
const RIGHT = [
  { href: '/trust', label: 'Trust', Icon: Shield },
  { href: '/profile', label: 'Account', Icon: User },
];

/** Bottom tab bar with a raised center "Create" action — only shown when signed in. */
export function BottomNav() {
  const pathname = usePathname();
  const { user, unread } = useAuth();
  if (!user) return null;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav className="sticky bottom-0 z-30 bg-surface/85 backdrop-blur-xl">
      <div className="hr" />
      <div className="relative grid grid-cols-5 items-center px-2 pb-[max(env(safe-area-inset-bottom),10px)] pt-2">
        {LEFT.map((t) => (
          <Tab key={t.href} {...t} active={isActive(t.href)} badge={t.href === '/notifications' ? unread : 0} />
        ))}

        {/* Center FAB — Create a safe trade */}
        <div className="flex justify-center">
          <Link
            href="/create"
            aria-label="Create a safe trade"
            className="grid place-items-center h-14 w-14 rounded-full bg-brand text-brand-ink shadow-fab -translate-y-4 active:scale-95 transition hover:bg-brand-dark"
          >
            <Plus width={26} height={26} strokeWidth={2.4} />
          </Link>
        </div>

        {RIGHT.map((t) => (
          <Tab key={t.href} {...t} active={isActive(t.href)} badge={0} />
        ))}
      </div>
    </nav>
  );
}

function Tab({
  href, label, Icon, active, badge,
}: {
  href: string; label: string; Icon: typeof Home; active: boolean; badge: number;
}) {
  return (
    <Link
      href={href}
      className={`relative flex flex-col items-center gap-1 py-1 rounded-xl transition ${
        active ? 'text-brand' : 'text-faint'
      }`}
    >
      <span className="relative">
        <Icon width={23} height={23} strokeWidth={active ? 2.1 : 1.75} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-danger text-sink text-[10px] font-bold tnum">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      <span className="text-[11px] font-semibold tracking-tight">{label}</span>
    </Link>
  );
}
