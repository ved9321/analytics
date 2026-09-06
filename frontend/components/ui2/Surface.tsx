'use client';
import React from 'react';

// Translucent material surfaces.
//
// Weight encodes hierarchy: heavier materials separate structural regions,
// lighter ones draw attention to interactive elements. Two light materials
// are never stacked, because legibility collapses — the `nested` prop makes
// a child surface solid instead.
//
// Honours prefers-reduced-transparency by falling back to a solid fill,
// which is a real accessibility need, not a nicety: motion-sensitive and
// low-vision users genuinely cannot read text over a busy blur.

type Weight = 'chrome' | 'panel' | 'sheet' | 'popover' | 'flat';

const WEIGHTS: Record<Weight, React.CSSProperties> = {
  // Floating chrome over a light field: translucent white with a blur, so
  // content scrolling underneath stays perceptible without competing.
  // Every value reads from a theme variable. Hardcoding white here meant a
  // panel stayed white in dark mode, which is what made the toggle look
  // broken rather than themed.
  chrome: {
    background: 'rgb(var(--card) / 0.72)',
    backdropFilter: 'blur(20px) saturate(180%)',
  },
  panel: {
    background: 'rgb(var(--card))',
    boxShadow: 'var(--shadow-card)',
  },
  sheet: {
    background: 'rgb(var(--card))',
    boxShadow: 'var(--shadow-pop)',
  },
  popover: {
    background: 'rgb(var(--card) / 0.94)',
    backdropFilter: 'blur(24px) saturate(160%)',
    boxShadow: 'var(--shadow-pop)',
  },
  flat: { background: 'rgb(var(--card))' },
};

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  weight?: Weight;
  /** Inside another translucent surface: renders solid to stay legible. */
  nested?: boolean;
  /** A bright top edge, as if light were catching the material. */
  topEdge?: boolean;
}

// forwardRef because Sheet needs a handle on the element to read its live
// transform when a gesture interrupts an in-flight animation. Without it the
// ref is silently null and the interruption reads the target value instead
// of the presentation value — the exact jump the spring system exists to
// avoid.
export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { weight = 'panel', nested, topEdge, className = '', style, children, ...props },
  ref
) {
  const base = nested ? WEIGHTS.flat : WEIGHTS[weight];

  return (
    <div
      {...props}
      ref={ref}
      data-surface={weight}
      className={`relative ${className}`}
      style={{
        ...base,
        ...(topEdge ? { borderTop: '1px solid rgb(var(--line-soft))' } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
});
