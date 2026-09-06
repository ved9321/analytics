// Design tokens, derived from Apple's interface guidance rather than a
// generic dark theme.
//
// Two ideas drive the whole system:
//
//  1. Type is size-specific. Apple's typography talk is explicit that a
//     single letter-spacing value is wrong somewhere — large text needs
//     negative tracking because letters read too far apart as they grow,
//     small text needs slightly positive tracking for legibility. So every
//     step in the scale carries its own tracking and leading rather than
//     inheriting one global value.
//
//  2. Material weight encodes hierarchy. Heavier, darker materials separate
//     structural regions; lighter ones draw attention to interactive
//     elements. A light translucent surface is never stacked on another,
//     because legibility collapses.

// --- Type scale ---------------------------------------------------------
// Each step is a set: size, weight, leading and tracking chosen together.
// Sizes are rem so they scale with the user's text-size preference.

export interface TypeStep {
  size: string;
  lineHeight: string;
  letterSpacing: string;
  weight: number;
}

export const type = {
  display: { size: '2rem', lineHeight: '1.08', letterSpacing: '-0.022em', weight: 600 },
  title1: { size: '1.375rem', lineHeight: '1.15', letterSpacing: '-0.018em', weight: 600 },
  title2: { size: '1.0625rem', lineHeight: '1.25', letterSpacing: '-0.012em', weight: 600 },
  title3: { size: '0.9375rem', lineHeight: '1.3', letterSpacing: '-0.008em', weight: 590 },
  body: { size: '0.8125rem', lineHeight: '1.55', letterSpacing: '0', weight: 400 },
  callout: { size: '0.8125rem', lineHeight: '1.45', letterSpacing: '0', weight: 500 },
  subhead: { size: '0.75rem', lineHeight: '1.4', letterSpacing: '0.004em', weight: 400 },
  footnote: { size: '0.6875rem', lineHeight: '1.35', letterSpacing: '0.008em', weight: 400 },
  caption: { size: '0.625rem', lineHeight: '1.3', letterSpacing: '0.014em', weight: 500 },
} satisfies Record<string, TypeStep>;

// Numerals get their own treatment: tabular figures so columns align, and
// slightly tighter tracking because digits are already monospaced-wide.
export const numeric = {
  hero: { size: '1.75rem', lineHeight: '1', letterSpacing: '-0.02em', weight: 550 },
  large: { size: '1.25rem', lineHeight: '1', letterSpacing: '-0.014em', weight: 550 },
  body: { size: '0.8125rem', lineHeight: '1.4', letterSpacing: '-0.006em', weight: 450 },
} satisfies Record<string, TypeStep>;

// --- Spacing ------------------------------------------------------------
// A 4px base. Named by role rather than size so a change of scale doesn't
// require renaming everything.
export const space = {
  hair: '0.125rem',
  tight: '0.25rem',
  snug: '0.5rem',
  base: '0.75rem',
  comfortable: '1rem',
  loose: '1.5rem',
  section: '2rem',
  page: '2.5rem',
} as const;

// --- Radii --------------------------------------------------------------
// Concentric: a nested element's radius is the parent's minus the padding
// between them, or the corners visibly disagree.
export const radius = {
  none: '0',
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '20px',
  pill: '999px',
} as const;

/** Inner radius that stays concentric with an outer corner. */
export function concentric(outer: number, padding: number): number {
  return Math.max(outer - padding, 2);
}

// --- Colour -------------------------------------------------------------
// A near-black base rather than pure black: pure black against a bright
// chart reads as a hole, and shadows have nowhere to go.
export const color = {
  // Structural surfaces, darkest to lightest.
  canvas: '#0A0C10',
  surface: '#111419',
  raised: '#171B22',
  overlay: '#1D222A',

  // Hairlines. Two weights: structural and incidental.
  border: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  borderFaint: 'rgba(255, 255, 255, 0.06)',

  // Text. Vibrancy over translucent material needs more contrast and a
  // touch more weight than flat grey, or it dissolves into the blur.
  text: '#F2F4F7',
  textSecondary: 'rgba(242, 244, 247, 0.66)',
  textTertiary: 'rgba(242, 244, 247, 0.42)',

  // One accent, used for state and emphasis — never as a large fill.
  accent: '#E0A03A',
  accentMuted: 'rgba(224, 160, 58, 0.14)',

  // Semantic, reserved strictly for meaning.
  positive: '#3FB984',
  negative: '#E5606B',
  warning: '#E0A03A',
  info: '#5B9BF0',
} as const;

// Chart series: distinguishable at a glance, and still distinguishable in
// the common forms of colour blindness — hue plus lightness both vary.
export const series = ['#E0A03A', '#5B9BF0', '#3FB984', '#B87BD6', '#E5606B', '#4FC3C7', '#D48A5C', '#8B93A8'] as const;

// --- Materials ----------------------------------------------------------
// Bigger surfaces read as thicker: stronger blur and a deeper shadow than a
// small chip. Never stack two light materials.
export const material = {
  chrome: {
    background: 'rgba(17, 20, 25, 0.72)',
    backdropFilter: 'blur(20px) saturate(180%)',
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
  },
  panel: {
    background: 'rgba(23, 27, 34, 0.80)',
    backdropFilter: 'blur(28px) saturate(160%)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.44)',
  },
  sheet: {
    background: 'rgba(29, 34, 42, 0.88)',
    backdropFilter: 'blur(40px) saturate(150%)',
    boxShadow: '0 -12px 48px rgba(0, 0, 0, 0.56)',
  },
  popover: {
    background: 'rgba(29, 34, 42, 0.92)',
    backdropFilter: 'blur(24px) saturate(160%)',
    boxShadow: '0 6px 24px rgba(0, 0, 0, 0.40)',
  },
} as const;

// --- Elevation ----------------------------------------------------------
// Context-aware: heavier over busy content for separation, lighter over
// plain backgrounds.
export const elevation = {
  none: 'none',
  low: '0 1px 2px rgba(0, 0, 0, 0.30)',
  medium: '0 4px 16px rgba(0, 0, 0, 0.36)',
  high: '0 12px 40px rgba(0, 0, 0, 0.48)',
} as const;

// --- Z-index ------------------------------------------------------------
// Named so stacking is reasoned about once, not rediscovered per component.
export const layer = {
  base: 0,
  sticky: 10,
  chrome: 20,
  popover: 30,
  sheet: 40,
  modal: 50,
  toast: 60,
} as const;
