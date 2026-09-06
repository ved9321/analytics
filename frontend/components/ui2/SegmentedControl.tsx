'use client';
import React, { useRef, useState, useLayoutEffect } from 'react';

// The selected indicator slides between segments rather than cutting, so the
// eye can follow which option was chosen — the movement carries the
// information, not just the final state.

export interface Segment<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  size = 'sm',
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  // Measured after layout rather than derived from the index, so segments
  // size to their labels instead of being forced equal-width.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(`[data-value="${value}"]`);
    if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
  }, [value, segments]);

  const pad = size === 'sm' ? 'p-[3px]' : 'p-1';
  const text = size === 'sm' ? 'text-caption px-3 py-1.5' : 'text-body px-3.5 py-2';

  return (
    <div ref={containerRef} role="tablist" className={`relative inline-flex items-center rounded-pill bg-sunken ${pad}`}>
      <div
        aria-hidden
        className="absolute rounded-pill bg-card shadow-control"
        style={{
          left: 0,
          width: indicator.width,
          height: `calc(100% - ${size === 'sm' ? 6 : 8}px)`,
          transform: `translateX(${indicator.left}px)`,
          transition: 'transform 300ms cubic-bezier(0.32,0.72,0,1), width 300ms cubic-bezier(0.32,0.72,0,1)',
        }}
      />
      {segments.map((segment) => (
        <button
          key={segment.value}
          role="tab"
          aria-selected={segment.value === value}
          data-value={segment.value}
          onClick={() => onChange(segment.value)}
          className={`relative z-10 whitespace-nowrap rounded-pill font-medium transition-colors duration-150 ${text} ${
            segment.value === value ? 'text-ink' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
