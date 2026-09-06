'use client';

// Conversion funnel. Each stage is shown as a proportion of the FIRST stage,
// not of the one above it — a bar that resets to full width at every step
// hides exactly the drop-off the chart exists to show. The step-over-step
// rate is given as a second figure for the same reason.

export interface FunnelStage {
  label: string;
  value: number;
}

export default function Funnel({ stages }: { stages: FunnelStage[] }) {
  if (stages.length === 0) return null;
  const top = stages[0].value || 1;

  return (
    <div className="flex flex-col gap-3 px-5 pb-5 pt-1">
      {stages.map((stage, index) => {
        const ofTop = stage.value / top;
        const previous = index === 0 ? null : stages[index - 1].value;
        const stepRate = previous ? stage.value / (previous || 1) : null;

        return (
          <div key={stage.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-subhead font-medium text-ink-2">{stage.label}</span>
              <span className="flex items-baseline gap-2">
                <span className="tnum text-body font-semibold text-ink">
                  {stage.value.toLocaleString('en-US')}
                </span>
                <span className="tnum text-caption text-ink-3">{(ofTop * 100).toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-pill bg-sunken">
              <div
                className="h-full rounded-pill bg-gradient-to-r from-accent to-accent-400"
                style={{ width: `${Math.max(ofTop * 100, 0.6)}%` }}
              />
            </div>
            {stepRate !== null && (
              <div className="mt-1 text-caption text-ink-3">
                {(stepRate * 100).toFixed(1)}% of previous step
                {stepRate < 0.25 && <span className="ml-1.5 font-medium text-negative">steepest drop</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
