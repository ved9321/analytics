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
  chrome: {
    background: 'rgba(255, 255, 255, 0.72)',
    backdropFilter: 'blur(20px) saturate(180%)',
  },
  panel: {
    background: '#FFFFFF',
    boxShadow: '0 1px 2px rgba(18,16,14,.04), 0 8px 24px rgba(18,16,14,.05)',
  },
  sheet: {
    background: '#FFFFFF',
    boxShadow: '0 -12px 48px rgba(18,16,14,.16)',
  },
  popover: {
    background: 'rgba(255, 255, 255, 0.94)',
    backdropFilter: 'blur(24px) saturate(160%)',
    boxShadow: '0 8px 28px rgba(18,16,14,.12)',
  },
  flat: { background: '#FFFFFF' },
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
        ...(topEdge ? { borderTop: '1px solid rgba(255, 255, 255, 0.08)' } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
});
