'use client';
import { useRef, useCallback } from 'react';
import { VelocityTracker, rubberband, gesture } from './motion';

// One-to-one drag tracking with velocity capture.
//
// Three details that separate this from a naive pointermove handler, all of
// them from Apple's fluid-interfaces guidance:
//
//  1. The grab offset is respected. Snapping the element's centre to the
//     pointer on grab breaks the illusion instantly — the thing has to stay
//     under the exact point you took hold of.
//  2. setPointerCapture, so tracking survives the pointer leaving the
//     element's bounds mid-drag.
//  3. A movement threshold before committing to a direction, so a tap that
//     wobbles by two pixels is still a tap.

export interface DragState {
  offset: number;
  velocity: number;
  isDragging: boolean;
}

export interface UseDragOptions {
  axis?: 'x' | 'y';
  /** Called continuously during the drag, never only at the end. */
  onDrag?: (state: DragState) => void;
  onRelease?: (state: DragState) => void;
  /** Beyond these, movement is rubber-banded rather than stopped. */
  bounds?: { min?: number; max?: number };
  /** Size used to scale the rubber-band resistance. */
  dimension?: number;
  disabled?: boolean;
}

export function useDrag(options: UseDragOptions = {}) {
  const { axis = 'y', onDrag, onRelease, bounds, dimension = 400, disabled } = options;

  const tracker = useRef(new VelocityTracker());
  const start = useRef(0);
  const committed = useRef(false);
  const active = useRef(false);

  const coordinate = useCallback(
    (event: React.PointerEvent | PointerEvent) => (axis === 'y' ? event.clientY : event.clientX),
    [axis]
  );

  const applyBounds = useCallback(
    (raw: number) => {
      if (!bounds) return raw;
      // Past a boundary, resist progressively rather than stopping hard: a
      // hard stop reads as frozen, resistance reads as "nothing more here".
      if (bounds.min !== undefined && raw < bounds.min) {
        return bounds.min + rubberband(raw - bounds.min, dimension);
      }
      if (bounds.max !== undefined && raw > bounds.max) {
        return bounds.max + rubberband(raw - bounds.max, dimension);
      }
      return raw;
    },
    [bounds, dimension]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return;
      // Capture so the drag continues even if the pointer leaves the element.
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      start.current = coordinate(event);
      committed.current = false;
      active.current = true;
      tracker.current.reset();
      tracker.current.add(0);
    },
    [coordinate, disabled]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!active.current || disabled) return;
      const raw = coordinate(event) - start.current;

      // Hysteresis: don't commit to a drag until the pointer has actually
      // travelled, or every slightly-imprecise tap becomes a drag.
      if (!committed.current) {
        if (Math.abs(raw) < gesture.hysteresis) return;
        committed.current = true;
      }

      const offset = applyBounds(raw);
      tracker.current.add(raw);
      onDrag?.({ offset, velocity: tracker.current.velocity, isDragging: true });
    },
    [coordinate, applyBounds, onDrag, disabled]
  );

  const finish = useCallback(
    (event: React.PointerEvent) => {
      if (!active.current) return;
      active.current = false;
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);

      if (!committed.current) return; // it was a tap, not a drag
      const raw = coordinate(event) - start.current;
      onRelease?.({
        offset: applyBounds(raw),
        // Release velocity is handed to the spring so there is no visible
        // seam between dragging and animating.
        velocity: tracker.current.velocity,
        isDragging: false,
      });
    },
    [coordinate, applyBounds, onRelease]
  );

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      // Prevents the browser from claiming the gesture for scrolling.
      style: { touchAction: axis === 'y' ? ('pan-x' as const) : ('pan-y' as const) },
    },
    isDragging: () => active.current && committed.current,
  };
}
