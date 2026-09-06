'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, TraceDetail } from '../lib/apiClient';
import { Skeleton, InlineAlert, Badge } from './ui';

// Drill-down (spec §6): shows exactly which tools produced an answer and
// the rows behind it, so a figure in chat can be verified rather than
// taken on trust.
export default function TraceViewer({
  workspaceId,
  traceId,
  onClose,
}: {
  workspaceId: string;
  traceId: string;
  onClose: () => void;
}) {
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTrace(workspaceId, traceId)
      .then(setTrace)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the source data'));
  }, [workspaceId, traceId]);

  // Escape closes, matching every other dismissible panel people expect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const metricKeys = trace?.rows.length
    ? Object.keys(trace.rows[0].metrics).slice(0, 5)
    : [];

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col border-l border-line bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-line-soft px-5 py-3">
          <div>
            <h2 className="text-body font-medium text-paper">Where this came from</h2>
            {trace && (
              <p className="mt-0.5 text-caption text-muted">
                {trace.model} · {trace.tokens.input ?? 0} in / {trace.tokens.output ?? 0} out tokens ·{' '}
                {new Date(trace.createdAt).toLocaleString()}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-paper" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <InlineAlert>{error}</InlineAlert>}
          {!trace && !error && <Skeleton className="h-40" />}

          {trace && (
            <>
              <h3 className="mb-2 text-subhead text-muted">Queries run</h3>
              <div className="mb-6 space-y-1.5">
                {trace.toolCalls.length === 0 && (
                  <p className="text-subhead text-muted">No data queries were needed for this answer.</p>
                )}
                {trace.toolCalls.map((call, i) => (
                  <div key={i} className="rounded-sm bg-sunken px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-subhead text-signal">{call.name}</span>
                      {call.rowCount != null && <Badge>{call.rowCount} rows</Badge>}
                    </div>
                    {Object.keys((call.input as object) ?? {}).length > 0 && (
                      <pre className="mt-1 overflow-x-auto font-mono text-caption text-muted">
                        {JSON.stringify(call.input)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>

              <h3 className="mb-2 text-subhead text-muted">
                Source rows · {trace.date_range} · showing {trace.rows.length}
              </h3>
              {trace.rows.length === 0 ? (
                <p className="text-subhead text-muted">No underlying rows for this slice.</p>
              ) : (
                <div className="overflow-x-auto border border-line-soft">
                  <table className="w-full text-left text-subhead">
                    <thead>
                      <tr className="border-b border-line-soft text-muted">
                        <th className="px-3 py-2 font-normal">Date</th>
                        <th className="px-3 py-2 font-normal">Source</th>
                        <th className="px-3 py-2 font-normal">Entity</th>
                        {metricKeys.map((key) => (
                          <th key={key} className="px-3 py-2 text-right font-normal">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="tnum">
                      {trace.rows.map((row, i) => (
                        <tr key={i} className="border-b border-line-soft last:border-0">
                          <td className="whitespace-nowrap px-3 py-1.5">{row.date}</td>
                          <td className="px-3 py-1.5 text-muted">{row.source}</td>
                          <td className="max-w-[180px] truncate px-3 py-1.5 font-sans">
                            {typeof row.dimensions.campaign_name === 'string'
                              ? row.dimensions.campaign_name
                              : row.entityId}
                          </td>
                          {metricKeys.map((key) => (
                            <td key={key} className="px-3 py-1.5 text-right">
                              {(row.metrics[key] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
