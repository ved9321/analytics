import type { Config } from 'tailwindcss';

// Prism design language.
//
// A light, card-based surface rather than a dark console: white cards on a
// warm neutral field, large radii, one confident accent, and generous
// spacing. Density still matters — this is an analytics product — but it
// comes from information hierarchy, not from cramming 11px text onto black.
//
// Legacy names (ink, paper, muted, signal, line) are kept as aliases so the
// existing pages keep compiling while they migrate; they now resolve to the
// light palette.

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Every colour reads from a CSS variable, so one class works in both
        // themes and there is no duplicated dark: variant anywhere.
        field: 'rgb(var(--field) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        contrast: 'rgb(var(--contrast) / <alpha-value>)',
        'on-contrast': 'rgb(var(--on-contrast) / <alpha-value>)',
        'invert-panel': 'rgb(var(--invert-panel) / <alpha-value>)',
        'on-invert-panel': 'rgb(var(--on-invert-panel) / <alpha-value>)',

        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          2: 'rgb(var(--ink-2) / <alpha-value>)',
          3: 'rgb(var(--ink-3) / <alpha-value>)',
          // Legacy numeric aliases, so unmigrated pages stay legible.
          950: 'rgb(var(--ink) / <alpha-value>)',
          900: 'rgb(var(--card) / <alpha-value>)',
          800: 'rgb(var(--sunken) / <alpha-value>)',
          700: 'rgb(var(--raised) / <alpha-value>)',
        },

        line: 'rgb(var(--line) / <alpha-value>)',
        'line-soft': 'rgb(var(--line-soft) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',

        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
        },
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',

        positive: 'rgb(var(--positive) / <alpha-value>)',
        'positive-soft': 'rgb(var(--positive-soft) / <alpha-value>)',
        negative: 'rgb(var(--negative) / <alpha-value>)',
        'negative-soft': 'rgb(var(--negative-soft) / <alpha-value>)',

        // Legacy aliases.
        paper: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--ink-2) / <alpha-value>)',
        faint: 'rgb(var(--ink-3) / <alpha-value>)',
        signal: 'rgb(var(--accent) / <alpha-value>)',
        canvas: 'rgb(var(--field) / <alpha-value>)',
        surface: 'rgb(var(--card) / <alpha-value>)',
      },

      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"SF Pro Text"',
          '"Segoe UI Variable Display"', '"Segoe UI"', 'Inter', 'system-ui', 'sans-serif',
        ],
        num: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"',
          '"Segoe UI Variable Display"', '"Segoe UI"', 'Inter', 'system-ui', 'sans-serif',
        ],
        mono: ['"SF Mono"', 'ui-monospace', 'SFMono-Regular', '"JetBrains Mono"', 'monospace'],
      },

      // Tracking tightens as size grows; leading loosens as size shrinks.
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1.35', letterSpacing: '0.05em', fontWeight: '600' }],
        caption: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        subhead: ['0.8125rem', { lineHeight: '1.45', letterSpacing: '0' }],
        body: ['0.84375rem', { lineHeight: '1.5', letterSpacing: '-0.003em' }],
        callout: ['0.9375rem', { lineHeight: '1.4', letterSpacing: '-0.01em' }],
        title: ['1rem', { lineHeight: '1.3', letterSpacing: '-0.015em', fontWeight: '600' }],
        heading: ['1.3125rem', { lineHeight: '1.2', letterSpacing: '-0.022em', fontWeight: '650' }],
        display: ['1.6875rem', { lineHeight: '1.1', letterSpacing: '-0.028em', fontWeight: '650' }],
        metric: ['1.9375rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '650' }],
      },

      borderRadius: {
        sm: '10px',
        DEFAULT: '12px',
        md: '16px',
        lg: '20px',
        xl: '24px',
        pill: '999px',
      },

      boxShadow: {
        // Read from variables so dark mode gets its own, heavier values —
        // a light-theme shadow is invisible on a dark field.
        card: 'var(--shadow-card)',
        control: 'var(--shadow-control)',
        pop: 'var(--shadow-pop)',
        none: 'none',
      },

      transitionTimingFunction: {
        apple: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },

      spacing: { gutter: '0.875rem' },
    },
  },
  plugins: [],
};

export default config;
