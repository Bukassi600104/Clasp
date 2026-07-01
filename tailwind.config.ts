import type { Config } from 'tailwindcss';

/**
 * Clasp design system — dark, precise, quietly electric.
 * Hard rule: NO gradients anywhere. Every surface is a solid, deliberate color;
 * depth comes from elevation steps and restrained cyan glow shadows.
 * Ground is a deep blue-black; the single accent is signal cyan (#1FC6FF),
 * used for actions, progress, and anything that means "your money is moving".
 * All text tokens hold WCAG AA against their grounds:
 *   ink on paper ≈ 15.9:1 · muted ≈ 8.1:1 · faint ≈ 4.9:1 · brand on paper ≈ 8.9:1
 *   brand.ink on brand ≈ 9.4:1 (dark text on the cyan button).
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Grounds — deep blue-black elevation ramp
        paper: '#0A0F16',        // app background
        surface: '#111926',      // raised cards
        ink: '#EDF3F8',          // near-white primary text
        muted: '#A3B2C2',        // secondary text
        faint: '#66788C',        // tertiary / captions
        line: '#1E2A3A',         // hairline borders
        sink: '#05080D',         // deepest panels (hero cards)

        // Brand — signal cyan = "your money is safe / moving"
        brand: {
          DEFAULT: '#1FC6FF',
          dark: '#54D4FF',       // hover step (brighter reads as lit on dark)
          soft: '#0C2231',       // flat cyan-tinted fill
          ink: '#04121C',        // dark text ON cyan surfaces
        },
        // Structure accent — cool slate for calm informational blocks
        slate: {
          DEFAULT: '#AEBECB',
          soft: '#131D2A',
        },
        // States — brightened for dark ground, soft fills stay flat and dark
        warn: { DEFAULT: '#FFB224', soft: '#291F0E' },
        danger: { DEFAULT: '#FF6B5E', soft: '#2A1210' },
        info: { DEFAULT: '#6FB5F0', soft: '#101F30' },
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
        card: '0 1px 2px rgba(0,0,0,0.4), 0 12px 28px -14px rgba(0,0,0,0.55)',
        lift: '0 2px 6px rgba(0,0,0,0.45), 0 24px 48px -20px rgba(0,0,0,0.7)',
        fab: '0 0 0 1px rgba(31,198,255,0.25), 0 8px 26px -6px rgba(31,198,255,0.45)',
        glow: '0 0 18px -2px rgba(31,198,255,0.4)',
        'glow-lg': '0 0 34px -4px rgba(31,198,255,0.5)',
        inset: 'inset 0 0 0 1px rgba(237,243,248,0.06)',
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
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in': 'scale-in 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.22,1,0.36,1) infinite',
        'pulse-dot': 'pulse-dot 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
