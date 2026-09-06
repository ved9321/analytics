'use client';
import React, { useState, useCallback } from 'react';

// Press feedback that arrives on pointer-DOWN, not on release.
//
// This is the foundation the whole system rests on: the moment lag appears,
// directness "falls off a cliff". Waiting for click to show feedback feels
// dead, and no amount of animation elsewhere compensates.
//
// Also handles cancel-by-dragging-away-and-back, which people do constantly
// without noticing — you press, think better of it, slide off, then change
// your mind again.

export interface PressableProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** How far the surface depresses. Smaller for large surfaces. */
  scale?: number;
  as?: 'button' | 'div';
}

export function Pressable({ scale = 0.97, as = 'button', className = '', children, ...props }: PressableProps) {
  const [pressed, setPressed] = useState(false);

  const release = useCallback(() => setPressed(false), []);

  const Component = as as React.ElementType;

  return (
    <Component
      {...props}
      className={className}
      data-pressed={pressed || undefined}
      onPointerDown={(event: React.PointerEvent) => {
        setPressed(true);
        props.onPointerDown?.(event as React.PointerEvent<HTMLButtonElement>);
      }}
      onPointerUp={(event: React.PointerEvent) => {
        release();
        props.onPointerUp?.(event as React.PointerEvent<HTMLButtonElement>);
      }}
      // Sliding off cancels the press visually; sliding back re-arms it,
      // because pointerenter fires with the button still held.
      onPointerLeave={release}
      onPointerCancel={release}
      onBlur={release}
      style={{
        transform: pressed ? `scale(${scale})` : 'scale(1)',
        // Deliberately a short tween rather than a spring: this is a direct
        // response to a press, not a momentum interaction, so it should
        // settle immediately with no overshoot.
        transition: 'transform 100ms cubic-bezier(0.32, 0.72, 0, 1)',
        ...props.style,
      }}
    >
      {children}
    </Component>
  );
}
