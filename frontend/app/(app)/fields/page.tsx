'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Search, Ruler, Hash, Sparkles, AlertTriangle, ChevronDown, CircleDot,
} from 'lucide-react';
import { useWorkspace } from '../../../lib/workspaceContext';
import { api, FieldCatalog, CatalogField } from '../../../lib/apiClient';
import {
  Button, Card, CardHeader, Badge, Skeleton, InlineAlert, EmptyState, SegmentedControl,
} from '../../../components/ui';

// The field browser.
//
// Before this the only way to know a field existed was for it to already be
// in the database, so a GA4 property offering several hundred dimensions
// showed the handful the connector happened to request. This lists what each
// platform actually offers — standard and custom, dimensions and metrics —
// and lets you choose what gets pulled.

type KindFilter = 'all' | 'DIMENSION' | 'METRIC';
type SourceFilter = 'all' | 'custom' | 'enabled' | 'collected';

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'accent' }) {
  return (
    <div className="rounded-lg border border-line-soft bg-card px-4 py-3 shadow-control">
      <div className="text-caption text-ink-3">{label}</div>
      <div className={`tnum mt-0.5 text-title2 font-semibold ${tone === 'accent' ? 'text-accent' : ''}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  populated,
  busy,
  onToggle,
}: {
  field: CatalogField;
  populated: boolean;
  busy: boolean;
  onToggle: (field: CatalogField) => void;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line-soft px-5 py-3 last:border-0 hover:bg-sunken/50">
      <button
        role="switch"
        aria-checked={field.syncEnabled}
        aria-label={`Sync ${field.uiName}`}
        disabled={busy || field.deprecated}
        onClick={() => onToggle(field)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-pill p-0.5 transition-colors disabled:opacity-40 ${
          field.syncEnabled ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className="block h-4 w-4 rounded-pill bg-card shadow-control transition-transform duration-200 ease-apple"
          style={{ transform: field.syncEnabled ? 'translateX(16px)' : 'translateX(0)' }}
        />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-body font-medium ${field.deprecated ? 'text-ink-3 line-through' : ''}`}>
            {field.uiName}
          </span>
          {field.custom && <Badge tone="signal">custom</Badge>}
          {/* "Available" and "has data" are different things, and conflating
              them is why fields looked missing. */}
          {populated && <Badge tone="positive">has data</Badge>}
          {field.deprecated && <Badge tone="negative">deprecated</Badge>}
        </div>
        <div className="mt-0.5 font-mono text-caption text-ink-3">{field.apiName}</div>
        {field.description && (
          <p className="mt-1 max-w-3xl text-caption leading-relaxed text-ink-2">{field.description}</p>
        )}
      </div>

      <span className="mt-0.5 shrink-0 text-caption text-ink-3">
        {field.kind === 'DIMENSION' ? <Ruler size={13} /> : <Hash size={13} />}
      </span>
    </div>
  );
}

export default function FieldsPage() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [openConnector, setOpenConnector] = useState<string | null>(null);
  const [busyField, setBusyField] = useState<string | null>(null);

  async function load() {
    if (!workspace) return;
    setLoading(true);
    try {
      const result = await api.getFieldCatalog(workspace.id);
      setCatalog(result);
      setOpenConnector((current) => current ?? result.connectors[0]?.connectorId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the field catalogue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  async function refresh() {
    if (!workspace) return;
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const { results } = await api.refreshFieldCatalog(workspace.id);
      const failed = results.filter((result) => result.error);
      const found = results.reduce((sum, result) => sum + (result.discovered ?? 0), 0);
      setNotice(
        failed.length
          ? `Found ${found} fields. ${failed.length} connector${failed.length === 1 ? '' : 's'} failed: ${failed
              .map((result) => `${result.displayName ?? result.connectorId} (${result.error})`)
              .join('; ')}`
          : `Found ${found} fields across ${results.length} connector${results.length === 1 ? '' : 's'}.`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function toggle(field: CatalogField) {
    if (!workspace) return;
    setBusyField(field.id);
    // Optimistic: the round trip is short and a toggle that lags feels broken.
    setCatalog((current) =>
      current
        ? {
            ...current,
            connectors: current.connectors.map((connector) => ({
              ...connector,
              categories: connector.categories.map((category) => ({
                ...category,
                fields: category.fields.map((item) =>
                  item.id === field.id ? { ...item, syncEnabled: !item.syncEnabled } : item
                ),
              })),
            })),
          }
        : current
    );
    try {
      await api.setFieldsEnabled(workspace.id, [field.id], !field.syncEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
      await load();
    } finally {
      setBusyField(null);
    }
  }

  const populated = useMemo(() => new Set(catalog?.populatedKeys ?? []), [catalog]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const term = search.trim().toLowerCase();

    return catalog.connectors.map((connector) => {
      const categories = connector.categories
        .map((category) => ({
          category: category.category,
          fields: category.fields.filter((field) => {
            if (kind !== 'all' && field.kind !== kind) return false;
            if (source === 'custom' && !field.custom) return false;
            if (source === 'enabled' && !field.syncEnabled) return false;
            if (source === 'collected' && !populated.has(field.apiName)) return false;
            if (!term) return true;
            return (
              field.uiName.toLowerCase().includes(term) ||
              field.apiName.toLowerCase().includes(term) ||
              (field.description ?? '').toLowerCase().includes(term)
            );
          }),
        }))
        .filter((category) => category.fields.length > 0);

      return { ...connector, categories, matchCount: categories.reduce((sum, c) => sum + c.fields.length, 0) };
    });
  }, [catalog, search, kind, source, populated]);

  if (workspaceLoading || loading) {
    return (
      <div className="space-y-3.5 pt-2">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!catalog) return <div className="pt-2"><InlineAlert>{error ?? 'No catalogue'}</InlineAlert></div>;

  const nothingDiscovered = catalog.totals.fields === 0;

  return (
    <div className="pt-2">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display">Fields</h1>
          <p className="mt-1 max-w-2xl text-body text-ink-2">
            Every dimension and metric your connected platforms offer — standard and custom. Toggle one on and it is
            pulled on the next sync.
          </p>
        </div>
        <Button variant="primary" loading={refreshing} onClick={refresh}>
          <RefreshCw size={14} /> Discover fields
        </Button>
      </div>

      {error && <div className="mb-3.5"><InlineAlert>{error}</InlineAlert></div>}
      {notice && <div className="mb-3.5"><InlineAlert tone="signal">{notice}</InlineAlert></div>}

      {nothingDiscovered ? (
        <Card>
          <EmptyState
            title="No fields discovered yet"
            hint="Run discovery to read the schema from each connected platform. For GA4 this returns every dimension and metric the property exposes, including any your account defined."
            action={<Button variant="primary" loading={refreshing} onClick={refresh}><RefreshCw size={14} /> Discover fields</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-3.5 grid grid-cols-2 gap-3.5 lg:grid-cols-5">
            <Stat label="Total fields" value={catalog.totals.fields} />
            <Stat label="Dimensions" value={catalog.totals.dimensions} />
            <Stat label="Metrics" value={catalog.totals.metrics} />
            <Stat label="Custom" value={catalog.totals.custom} tone="accent" />
            <Stat label="Syncing" value={catalog.totals.enabled} />
          </div>

          <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
            <label className="relative flex-1 min-w-[240px]">
              <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, API name or description…"
                className="h-9 w-full rounded-pill border border-line bg-card pl-10 pr-4 text-body outline-none transition-colors focus:border-accent"
              />
            </label>
            <SegmentedControl
              value={kind}
              onChange={setKind}
              segments={[
                { value: 'all', label: 'All' },
                { value: 'DIMENSION', label: 'Dimensions' },
                { value: 'METRIC', label: 'Metrics' },
              ]}
            />
            <SegmentedControl
              value={source}
              onChange={setSource}
              segments={[
                { value: 'all', label: 'Any' },
                { value: 'custom', label: 'Custom' },
                { value: 'enabled', label: 'Syncing' },
                { value: 'collected', label: 'Has data' },
              ]}
            />
          </div>

          <div className="space-y-3.5">
            {filtered.map((connector) => {
              const open = openConnector === connector.connectorId;
              return (
                <Card key={connector.connectorId} className="overflow-hidden">
                  <button
                    onClick={() => setOpenConnector(open ? null : connector.connectorId)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-sunken/50"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-title">{connector.displayName}</span>
                        <Badge>{connector.type}</Badge>
                        {connector.counts.custom > 0 && (
                          <Badge tone="signal">
                            <Sparkles size={10} className="mr-1" />
                            {connector.counts.custom} custom
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-caption text-ink-3">
                        {connector.counts.dimensions} dimensions · {connector.counts.metrics} metrics ·{' '}
                        {connector.counts.enabled} syncing
                        {connector.schemaSyncedAt
                          ? ` · discovered ${new Date(connector.schemaSyncedAt).toLocaleDateString()}`
                          : ' · never discovered'}
                      </div>
                      {connector.schemaError && (
                        <div className="mt-1.5 flex items-center gap-1.5 text-caption text-negative">
                          <AlertTriangle size={11} /> {connector.schemaError}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {(search || kind !== 'all' || source !== 'all') && (
                        <span className="tnum text-caption text-ink-3">{connector.matchCount} matching</span>
                      )}
                      <ChevronDown size={15} className={`text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-line-soft">
                      {connector.categories.length === 0 ? (
                        <EmptyState title="Nothing matches these filters" />
                      ) : (
                        connector.categories.map((category) => (
                          <div key={category.category}>
                            <div className="flex items-center gap-2 bg-sunken px-5 py-2">
                              <CircleDot size={10} className="text-ink-3" />
                              <span className="text-micro uppercase text-ink-3">{category.category}</span>
                              <span className="tnum text-caption text-ink-3">{category.fields.length}</span>
                            </div>
                            {category.fields.map((field) => (
                              <FieldRow
                                key={field.id}
                                field={field}
                                populated={populated.has(field.apiName)}
                                busy={busyField === field.id}
                                onToggle={toggle}
                              />
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <p className="mt-4 max-w-3xl text-caption leading-relaxed text-ink-3">
            Enabling a field affects the next sync, not existing rows — re-sync the connector to backfill it. Each
            extra dimension is another paginated request, so GA4 syncs are capped at eight beyond the six standard
            reports to keep a sync inside its hourly window.
          </p>
        </>
      )}
    </div>
  );
}
