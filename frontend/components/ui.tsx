'use client';
import React from 'react';
import { Pressable } from './ui2/Pressable';

// Shared UI. Every export keeps its original signature, because these are
// used across ten pages — the visual language changes underneath rather than
// the API on top.

// ---------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'contrast';

export function Button({
  variant = 'secondary',
  size = 'sm',
  loading,
  disabled,
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  // Pill controls, because every control in the reference language is a
  // pill and mixing radii across a toolbar reads as unfinished.
  const sizes = {
    sm: 'h-9 px-3.5 text-body gap-1.5',
    md: 'h-11 px-5 text-callout gap-2',
  };
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-on-accent hover:bg-accent-hover shadow-control',
    secondary: 'bg-card text-ink border border-line hover:border-line-strong shadow-control',
    ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
    danger: 'bg-negative-soft text-negative hover:bg-negative hover:text-on-accent',
    contrast: 'bg-contrast text-on-contrast hover:opacity-90',
  };

  return (
    <Pressable
      scale={0.97}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center rounded-pill font-medium whitespace-nowrap',
        'transition-colors duration-150 ease-apple',
        'disabled:cursor-not-allowed disabled:opacity-40',
        sizes[size],
        variants[variant],
        className,
      ].join(' ')}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-60"
        />
      )}
      {children}
    </Pressable>
  );
}

/** Circular icon-only control, for toolbars and card corners. */
export function IconButton({
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Pressable
      scale={0.94}
      className={`grid h-9 w-9 place-items-center rounded-pill bg-card text-ink-2 shadow-control transition-colors hover:text-ink ${className}`}
      {...props}
    >
      {children}
    </Pressable>
  );
}

// ----------------------------------------------------------------- Badge

type BadgeTone = 'neutral' | 'positive' | 'negative' | 'signal' | 'contrast';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: React.ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-sunken text-ink-2',
    positive: 'bg-positive-soft text-positive',
    negative: 'bg-negative-soft text-negative',
    signal: 'bg-accent-soft text-accent',
    contrast: 'bg-contrast text-on-contrast',
  };
  return (
    <span className={`inline-flex items-center rounded-pill px-2.5 py-1 text-caption font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Signed percentage chip. Colour carries the direction, so the arrow is
 *  redundancy for anyone who can't distinguish the two. */
export function DeltaPill({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-caption text-ink-3">no prior data</span>;
  }
  // For cost-like metrics a rise is bad, so the polarity is inverted.
  const good = invert ? value < 0 : value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-pill px-2 py-0.5 text-caption font-semibold ${
        good ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative'
      }`}
    >
      {value >= 0 ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// -------------------------------------------------------------- Skeleton

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-sunken ${className}`} />;
}

// ------------------------------------------------------------ InlineAlert

export function InlineAlert({
  tone = 'negative',
  children,
}: {
  tone?: 'negative' | 'signal';
  children: React.ReactNode;
}) {
  const tones = {
    negative: 'bg-negative-soft text-negative',
    signal: 'bg-accent-soft text-accent',
  };
  return <div className={`rounded-md px-4 py-3 text-body font-medium ${tones[tone]}`}>{children}</div>;
}

// ------------------------------------------------------------------ Card

export function Card({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-xl border border-line-soft bg-card shadow-card ${className}`} {...props}>
      {children}
    </div>
  );
}

/** Card header: title, optional supporting line, optional right-hand slot. */
export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
      <div className="min-w-0">
        <h2 className="text-title text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-caption text-ink-3">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Metrics

export function StatCard({
  label,
  value,
  deltaPct,
  sparkline,
  hero,
  invertDelta,
  icon,
  note,
}: {
  label: string;
  value: string;
  deltaPct?: number | null;
  sparkline?: React.ReactNode;
  /** One metric per screen may be filled with the accent. */
  hero?: boolean;
  invertDelta?: boolean;
  icon?: React.ReactNode;
  note?: string;
}) {
  return (
    <div className={`rounded-xl p-5 shadow-card ${hero ? 'bg-accent text-on-accent' : 'border border-line-soft bg-card'}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className={`flex items-center gap-2.5 text-subhead font-medium ${hero ? 'text-on-accent/90' : 'text-ink-2'}`}>
          {icon && (
            <span className={`grid h-7 w-7 place-items-center rounded-sm ${hero ? 'bg-on-accent/20' : 'bg-accent-soft'}`}>
              {icon}
            </span>
          )}
          {label}
        </div>
        {sparkline}
      </div>
      <div className="tnum text-metric">{value}</div>
      <div className={`mt-2.5 flex items-center gap-2 text-caption ${hero ? 'text-on-accent/80' : 'text-ink-3'}`}>
        {hero && deltaPct != null && Number.isFinite(deltaPct) ? (
          <span className="rounded-pill bg-on-accent/20 px-2 py-0.5 font-semibold text-on-accent">
            {deltaPct >= 0 ? '↑' : '↓'} {Math.abs(deltaPct).toFixed(1)}%
          </span>
        ) : (
          <DeltaPill value={deltaPct} invert={invertDelta} />
        )}
        <span>{note ?? 'vs previous period'}</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Panel

export function Panel({
  title,
  action,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      {(title || action) && <CardHeader title={title} subtitle={subtitle} action={action} />}
      {children}
    </Card>
  );
}

/** Inverted panel, for the one block per page that should read as a
 *  conclusion rather than more data. */
export function ContrastPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-invert-panel p-5 text-on-invert-panel">
      <h3 className="mb-3.5 text-micro uppercase text-on-invert-panel/55">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function ContrastRow({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-body leading-relaxed text-on-invert-panel/90">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[7px] bg-on-invert-panel/[0.12] text-caption">
        {icon ?? '·'}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

// ------------------------------------------------------------ EmptyState

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-callout font-medium text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-sm text-subhead leading-relaxed text-ink-3">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------- Data table

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className = '',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      className={`border-b border-line px-5 py-2.5 text-micro uppercase text-ink-3 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`border-b border-line-soft px-5 py-3 text-body ${
        align === 'right' ? 'tnum text-right font-medium' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}

/** Proportional bar for an in-table share column. */
export function MiniBar({ fraction, tone = 'accent' }: { fraction: number; tone?: 'accent' | 'neutral' }) {
  const width = `${Math.max(Math.min(fraction, 1), 0) * 100}%`;
  return (
    <span className="flex justify-end">
      <span className="block h-1.5 w-24 overflow-hidden rounded-pill bg-sunken">
        <span className={`block h-full rounded-pill ${tone === 'accent' ? 'bg-accent' : 'bg-ink-3'}`} style={{ width }} />
      </span>
    </span>
  );
}

/** Coloured dot used to tie a table row to its chart series. */
export function SeriesDot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-pill" style={{ background: color }} />;
}

// The chart palette, exported so tables and charts agree on which colour
// belongs to which series.
// Single source of truth, shared with components/charts so a table row's
// dot matches its line on the chart.
export { SERIES as SERIES_COLORS } from './charts/types';

export { Pressable } from './ui2/Pressable';
export { Surface } from './ui2/Surface';
export { Sheet } from './ui2/Sheet';
export { SegmentedControl } from './ui2/SegmentedControl';
