// Motion system.
//
// The governing idea from Apple's fluid-interfaces work: an interface feels
// alive when motion starts from the current on-screen value, inherits the
// user's velocity, projects momentum forward, and can be grabbed and
// reversed at any instant. Springs are the tool for that, because they are
// inherently interruptible and velocity-aware.
//
// Apple deliberately replaced mass/stiffness/damping with two
// designer-facing parameters, and these are expressed the same way:
//
//   damping  — 1.0 is critically damped, no overshoot. Below 1.0 bounces.
//   response — how quickly the value reaches target, in seconds. Not a
//              duration: a spring has no fixed duration, its settle time
//              emerges from the parameters.
//
// Default is damping 1.0 everywhere. Bounce is added ONLY when the gesture
// itself carried momentum — overshoot on a menu that faded in feels wrong,
// overshoot on a card you flicked feels right.

export interface Spring {
  damping: number;
  response: number;
}

export const spring = {
  /** Default for anything not gesture-driven. Graceful, non-distracting. */
  default: { damping: 1.0, response: 0.35 },
  /** Repositioning an element under direct control. Apple ships 1.0/0.4. */
  move: { damping: 1.0, response: 0.4 },
  /** Momentum releases only — a flick, a throw, a drag release. */
  momentum: { damping: 0.8, response: 0.4 },
  /** Drawers and sheets. Apple ships 0.8/0.3. */
  sheet: { damping: 0.8, response: 0.3 },
  /** Small, frequent state changes that must not draw the eye. */
  subtle: { damping: 1.0, response: 0.22 },
} satisfies Record<string, Spring>;

/**
 * Framer Motion's `bounce` + `duration` spring API maps closely onto
 * Apple's damping + response, so this converts rather than reimplements.
 * bounce 0 is critically damped; higher bounce is less damping.
 */
export function toMotion(config: Spring) {
  return {
    type: 'spring' as const,
    bounce: Math.max(0, 1 - config.damping),
    duration: config.response,
  };
}

/**
 * Apple's momentum projection, from the Designing Fluid Interfaces sample
 * code. Deliberately NOT the textbook v²/(2·decel) form — this exponential
 * decay is what actually ships and what scroll deceleration feels like.
 *
 * Use it to decide WHERE a flick is heading, then snap to the nearest
 * target to that projected point. Snapping from the release point instead
 * is what makes a flick feel like it was ignored.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Nearest snap point to a projected landing position. */
export function nearestSnap(projected: number, snapPoints: number[]): number {
  return snapPoints.reduce((best, point) =>
    Math.abs(point - projected) < Math.abs(best - projected) ? point : best
  );
}

/**
 * Progressive resistance past a boundary. A hard stop reads as frozen;
 * continuous resistance reads as responsive with nothing more there.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Tracks recent pointer positions so release velocity is available at the
 * end of a gesture. Using only the last two points is too noisy; a short
 * window smooths it without adding lag.
 */
export class VelocityTracker {
  private samples: { value: number; time: number }[] = [];
  constructor(private windowMs = 100) {}

  add(value: number, time = performance.now()) {
    this.samples.push({ value, time });
    const cutoff = time - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].time < cutoff) this.samples.shift();
  }

  /** Pixels per second. Zero when there isn't enough history to be sure. */
  get velocity(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const elapsed = last.time - first.time;
    if (elapsed <= 0) return 0;
    return ((last.value - first.value) / elapsed) * 1000;
  }

  reset() {
    this.samples = [];
  }
}

/**
 * Whether a gesture should commit or snap back.
 *
 * Uses velocity SIGN in preference to position: a fast flick that has barely
 * moved should still commit, and a slow drag past halfway that reverses at
 * the last moment should not.
 */
export function shouldCommit(params: {
  offset: number;
  velocity: number;
  threshold: number;
  velocityThreshold?: number;
}): boolean {
  const velocityThreshold = params.velocityThreshold ?? 400;
  if (Math.abs(params.velocity) > velocityThreshold) return params.velocity > 0;
  return params.offset > params.threshold;
}

// --- Reduced motion -----------------------------------------------------
// Reduced motion does not mean no feedback; it means a gentler,
// non-vestibular equivalent. Opacity changes that aid comprehension stay.

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function prefersReducedTransparency(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
}

/** Spring, or a short cross-fade when the user has asked for less motion. */
export function respectMotion(config: Spring) {
  if (prefersReducedMotion()) return { type: 'tween' as const, duration: 0.18, ease: 'easeOut' as const };
  return toMotion(config);
}

// --- Gesture constants --------------------------------------------------
export const gesture = {
  /** Movement before a drag direction is committed to. */
  hysteresis: 10,
  /** Extra hit area around small targets. */
  hitPadding: 10,
  /** Minimum touch target, per accessibility guidance. */
  minTarget: 44,
} as const;
