// The canonical schema from the platform spec §4.3 — every connector maps
// its platform's raw response into this shape before anything is stored,
// so the chat layer, chart renderer, and (later) custom-metric engine never
// need to know which platform a number came from.

export interface CanonicalDimensions {
  [key: string]: string | number | boolean;
}

export interface CanonicalMetrics {
  [key: string]: number;
}

export interface CanonicalMetricEvent {
  entityType: string;
  entityId: string;
  date: Date;
  dimensions: CanonicalDimensions;
  metrics: CanonicalMetrics;
  rawData?: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ConnectorCredentials {
  [key: string]: string;
}

/** A dimension or metric the platform offers. */
export interface FieldDescriptor {
  kind: 'DIMENSION' | 'METRIC';
  /** The platform's identifier. */
  apiName: string;
  /** The platform's human name. */
  uiName: string;
  description?: string;
  /** The platform's own grouping, used to organise the browser. */
  category?: string;
  /** Defined by the account rather than shipped by the platform. */
  custom?: boolean;
  deprecated?: boolean;
}

/** Field names the user chose to sync, by kind. */
export interface SelectedFields {
  dimensions: string[];
  metrics: string[];
}

export interface SyncProgress {
  phase: 'preparing' | 'fetching' | 'saving' | 'completed' | 'failed';
  completed: number;
  total: number;
  message: string;
  warning?: string;
}

export interface ConnectorAdapter {
  type: string;
  /** Validate credentials without pulling a full sync. */
  testConnection(credentials: ConnectorCredentials): Promise<{ ok: boolean; message?: string }>;
  /** Pull the last `days` of data, mapped into the canonical schema. */
  sync(
    credentials: ConnectorCredentials,
    days: number,
    range?: SyncRange,
    /** Fields the user enabled in the catalogue. Adapters that ignore this
     *  fall back to their own defaults, so it is additive. */
    selected?: SelectedFields,
    onProgress?: (progress: SyncProgress) => void,
  ): Promise<CanonicalMetricEvent[]>;
  /**
   * Every dimension and metric the platform exposes, standard and custom.
   *
   * Optional: a connector without a schema endpoint simply has no catalogue,
   * rather than the whole feature being gated on all of them having one.
   */
  describeSchema?(credentials: ConnectorCredentials): Promise<FieldDescriptor[]>;
}

export interface SyncRange {
  startDate?: string;
  endDate?: string;
  allAvailable?: boolean;
}
