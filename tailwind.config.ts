import type { Config } from 'tailwindcss';

/**
 * Clasp design system — "trust-forward, flat, premium".
 * Hard rule: NO gradients anywhere. Every surface is a solid, deliberate color.
 * Palette is built around a single confident emerald ("safe / locked") on a
 * warm paper ground with deep ink type, plus a serious clay tone for warnings.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Grounds — bright, cool, airy (reference fintech look)
        paper: '#F2F3F5',        // light cool app background
        surface: '#FFFFFF',      // raised cards
        ink: '#11131A',          // near-black primary text
        muted: '#5B616E',        // secondary text
        faint: '#9AA0AC',        // tertiary / captions
        line: '#ECEDF1',         // hairline borders
        sink: '#15181F',         // deep ink panels (dark sections)

        // Brand — emerald = "your money is safe / locked"
        brand: {
          DEFAULT: '#0E7A53',
          dark: '#0A5C3E',
          soft: '#E6F1EB',       // tinted fill, still flat
        },
        // Trust accent — deep slate used for structure & seller side
        slate: {
          DEFAULT: '#1C2A2F',
          soft: '#EAECEC',
        },
        // States
        warn: { DEFAULT: '#B45309', soft: '#FBEEDD' },   // amber — attention/deadline
        danger: { DEFAULT: '#A12D26', soft: '#F8E7E5' }, // clay red — dispute/nuclear
        info: { DEFAULT: '#1F5E8C', soft: '#E5EFF6' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        xl: '14px',
        '2xl': '20px',
        '3xl': '28px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(17,19,26,0.03), 0 12px 28px -14px rgba(17,19,26,0.12)',
        lift: '0 2px 6px rgba(17,19,26,0.05), 0 24px 48px -20px rgba(17,19,26,0.18)',
        fab: '0 8px 22px -6px rgba(14,122,83,0.45)',
        inset: 'inset 0 0 0 1px rgba(17,19,26,0.05)',
      },
      maxWidth: {
        app: '460px', // mobile-first Pi Browser viewport
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.6' },
          '70%, 100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in': 'scale-in 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.22,1,0.36,1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
