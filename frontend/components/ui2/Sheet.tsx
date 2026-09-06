'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useDrag } from '../../lib/design/useDrag';
import { spring, project, shouldCommit, prefersReducedMotion } from '../../lib/design/motion';
import { Surface } from './Surface';

// A draggable sheet, built to the interruptibility rule.
//
// The behaviours that matter, and why a CSS-transition sheet cannot have
// them:
//
//  - Dragging tracks the finger 1:1 the entire way, updating continuously
//    rather than animating only on release.
//  - Release velocity decides dismissal, not just distance. A fast flick
//    downward dismisses even from near the top; a fast flick back up
//    cancels even from near the bottom.
//  - The landing point is projected from momentum, so a throw behaves like
//    a throw.
//  - Grabbing it again mid-animation takes control back immediately,
//    starting from wherever it currently is on screen — not from the value
//    it was animating toward.
//
// Enter and exit share the same path: it arrives from the bottom and leaves
// to the bottom, so the spatial relationship holds.

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Fraction of viewport height. */
  height?: number;
}

export function Sheet({ open, onClose, title, children, height = 0.72 }: SheetProps) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const reduced = prefersReducedMotion();

  const sheetHeight = typeof window === 'undefined' ? 600 : window.innerHeight * height;

  // Reset only when it opens, so a dismissal animation isn't cut short.
  useEffect(() => {
    if (open) setOffset(0);
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && open && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  /**
   * Spring animation driven by rAF rather than a CSS transition, because a
   * CSS transition cannot be grabbed and reversed mid-flight — it would
   * have to finish first, which is exactly the "brick wall" feel to avoid.
   */
  const animateTo = useCallback(
    (target: number, initialVelocity: number, onSettled?: () => void) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (reduced) {
        setOffset(target);
        onSettled?.();
        return;
      }

      setAnimating(true);
      // Convert damping/response into the stiffness/damping the integrator
      // needs. Response is the time to reach target, not a duration.
      const { damping, response } = spring.sheet;
      const stiffness = (2 * Math.PI / response) ** 2;
      const dampingCoefficient = (4 * Math.PI * damping) / response;

      let position = offset;
      let velocity = initialVelocity;
      let last = performance.now();

      const step = (now: number) => {
        // Clamp dt: a backgrounded tab produces a huge delta that would
        // fling the integrator to infinity.
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;

        const acceleration = -stiffness * (position - target) - dampingCoefficient * velocity;
        velocity += acceleration * dt;
        position += velocity * dt;

        setOffset(position);

        if (Math.abs(position - target) < 0.5 && Math.abs(velocity) < 10) {
          setOffset(target);
          setAnimating(false);
          onSettled?.();
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [offset, reduced]
  );

  const { handlers } = useDrag({
    axis: 'y',
    // Upward drag is rubber-banded: there is nothing above the sheet, and a
    // hard stop would read as frozen.
    bounds: { min: 0 },
    dimension: sheetHeight,
    onDrag: ({ offset: next }) => {
      // Taking hold mid-animation cancels it and hands control straight
      // back, continuing from the current on-screen position.
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        setAnimating(false);
      }
      setOffset(next);
    },
    onRelease: ({ offset: released, velocity }) => {
      // Project where the throw is heading rather than judging from where
      // the finger happened to stop.
      const projected = released + project(velocity);
      const dismiss = shouldCommit({
        offset: projected,
        velocity,
        threshold: sheetHeight * 0.4,
        velocityThreshold: 500,
      });

      if (dismiss) {
        // Hand the release velocity to the spring so there is no seam
        // between the drag and the animation.
        animateTo(sheetHeight, velocity, onClose);
      } else {
        animateTo(0, velocity);
      }
    },
  });

  if (!open && offset === 0) return null;

  const progress = Math.min(offset / sheetHeight, 1);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      {/* Scrim dims proportionally to the drag, so the surface and its
          background stay connected the whole way. */}
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black"
        style={{ opacity: 0.5 * (1 - progress), transition: animating ? 'none' : 'opacity 120ms linear' }}
      />

      <Surface
        ref={panelRef}
        weight="flat"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-2xl rounded-t-xl bg-card will-change-transform"
        style={{
          height: `${height * 100}vh`,
          transform: `translate3d(0, ${offset}px, 0)`,
        }}
      >
        {/* The grab handle is the affordance; the whole header is draggable
            so people don't have to hit a 4px target. */}
        <div {...handlers} className="cursor-grab active:cursor-grabbing px-5 pt-3 pb-2">
          <div className="mx-auto h-1 w-10 rounded-pill bg-line-strong" />
          {title && (
            <h2 className="mt-3 text-title text-ink">{title}</h2>
          )}
        </div>

        <div className="h-full overflow-y-auto px-5 pb-8">{children}</div>
      </Surface>
    </div>
  );
}
