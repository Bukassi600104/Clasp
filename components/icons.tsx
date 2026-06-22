import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
});

export const Lock = (p: P) => (
  <svg {...base(p)}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    <circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const Shield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3z" />
    <path d="M9 12l2 2 4-4.5" />
  </svg>
);

export const Clock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const Check = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

export const Plus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ArrowLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const Bell = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 1.5 6 1.5 6h-15S6 14 6 9z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

export const Home = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 11.5L12 5l8 6.5" />
    <path d="M6 10.5V19h12v-8.5" />
  </svg>
);

export const User = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
  </svg>
);

export const Share = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="17" cy="6" r="2.5" />
    <circle cx="17" cy="18" r="2.5" />
    <path d="M8.2 10.8l6.6-3.6M8.2 13.2l6.6 3.6" />
  </svg>
);

export const Copy = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
);

export const Truck = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7.5h11v8H3zM14 10.5h4l3 3v2h-7z" />
    <circle cx="7" cy="17.5" r="1.6" />
    <circle cx="17.5" cy="17.5" r="1.6" />
  </svg>
);

export const Scale = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v16M7 20h10" />
    <path d="M12 6l-6 2 2.5 5a2.6 2.6 0 0 1-5 0L6 8M12 6l6 2-2.5 5a2.6 2.6 0 0 0 5 0L18 8" />
  </svg>
);

export const Flame = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c1 1 2 2 2 4a4 4 0 1 1-8 0c0-4 4-5 4-11z" />
  </svg>
);

export const Spark = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
  </svg>
);

export const ExternalLink = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 5h5v5M19 5l-8 8" />
    <path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

export const Info = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

export const ArrowUpRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 17L17 7M9 7h8v8" />
  </svg>
);

export const ArrowDownLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M17 7L7 17M15 17H7V9" />
  </svg>
);

export const Eye = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const EyeOff = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4l16 16M9.9 5.6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.3 3M6.2 7.7A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 3-.5" />
    <path d="M9.6 10a2.6 2.6 0 0 0 3.6 3.6" />
  </svg>
);

export const Scan = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M4 12h16" />
  </svg>
);

export const Activity = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12h3.5l2-6 4 12 2.5-7 1.5 4H21" />
  </svg>
);

export const PiSymbol = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 8h14M8 8v9M16 8v7a1.5 1.5 0 0 0 3 0" />
  </svg>
);
