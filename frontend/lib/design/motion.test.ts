import { describe, it, expect } from 'vitest';
import { toMotion, spring, project, nearestSnap, rubberband, VelocityTracker, shouldCommit } from './motion';

// Apple's fluid-interfaces model: motion starts from the current value,
// inherits the user's velocity, projects momentum forward, and can be
// grabbed and reversed at any instant. These pin down the physics.

describe('spring mapping', () => {
  it('maps critical damping to zero bounce', () => {
    expect(toMotion({ damping: 1, response: 0.35 })).toEqual({ type: 'spring', bounce: 0, duration: 0.35 });
  });

  it('bounces only where the gesture carried momentum', () => {
    // Overshoot on a menu that faded in feels wrong; on a flicked card, right.
    expect(toMotion(spring.default).bounce).toBe(0);
    expect(toMotion(spring.move).bounce).toBe(0);
    expect(toMotion(spring.momentum).bounce).toBeGreaterThan(0);
    expect(toMotion(spring.sheet).bounce).toBeGreaterThan(0);
  });

  it('preserves the values Apple actually ships', () => {
    expect(spring.move).toEqual({ damping: 1.0, response: 0.4 });
    expect(spring.sheet).toEqual({ damping: 0.8, response: 0.3 });
  });
});

describe('momentum projection', () => {
  it('uses exponential decay rather than the textbook formula', () => {
    // (1000/1000) * 0.998 / 0.002 = 499
    expect(project(1000)).toBeCloseTo(499, 0);
  });

  it('preserves direction and scales with velocity', () => {
    expect(project(-800)).toBeLessThan(0);
    expect(project(1000)).toBeGreaterThan(project(500));
  });

  it('snaps to the projected landing point, not the release point', () => {
    // This is what makes a flick feel like a throw instead of being ignored.
    const release = 100;
    const snaps = [0, 300, 600];
    expect(nearestSnap(release + project(1200), snaps)).toBe(600);
    expect(nearestSnap(release, snaps)).toBe(0);
  });
});

describe('rubber-banding', () => {
  it('resists progressively instead of stopping hard', () => {
    expect(rubberband(0, 400)).toBe(0);
    for (const overshoot of [10, 50, 200, 500]) {
      expect(Math.abs(rubberband(overshoot, 400))).toBeLessThan(overshoot);
    }
    expect(rubberband(200, 400)).toBeGreaterThan(rubberband(50, 400));
  });

  it('behaves symmetrically', () => {
    expect(rubberband(-100, 400)).toBeCloseTo(-rubberband(100, 400), 5);
  });
});

describe('velocity tracking', () => {
  it('needs two samples before reporting', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    expect(tracker.velocity).toBe(0);
  });

  it('reports pixels per second, signed', () => {
    const forward = new VelocityTracker();
    forward.add(0, 0); forward.add(50, 100);
    expect(forward.velocity).toBeCloseTo(500, 0);

    const backward = new VelocityTracker();
    backward.add(100, 0); backward.add(0, 100);
    expect(backward.velocity).toBeCloseTo(-1000, 0);
  });

  it('discards samples outside the window so old motion does not linger', () => {
    const tracker = new VelocityTracker(100);
    tracker.add(0, 0); tracker.add(1000, 50);       // fast
    tracker.add(1010, 400); tracker.add(1020, 500); // then nearly stopped
    expect(Math.abs(tracker.velocity)).toBeLessThan(200);
  });
});

describe('commit decision', () => {
  it('prefers velocity sign over position', () => {
    // A fast flick commits even when barely moved.
    expect(shouldCommit({ offset: 5, velocity: 900, threshold: 100 })).toBe(true);
    // A fast reverse cancels even from well past the threshold.
    expect(shouldCommit({ offset: 250, velocity: -900, threshold: 100 })).toBe(false);
  });

  it('falls back to position for slow drags', () => {
    expect(shouldCommit({ offset: 150, velocity: 10, threshold: 100 })).toBe(true);
    expect(shouldCommit({ offset: 40, velocity: 10, threshold: 100 })).toBe(false);
  });
});
