import { describe, it, expect } from 'vitest';
import {
  buildTasks, rowLimitFor, normaliseMetricName, mergeRows, shouldPaginate,
  entityTypeFor, estimateRequests,
} from '../src/modules/connectors/ga4/ga4Planner';

// "Pull everything" is a scheduling problem. The Data API allows at most 9
// dimensions and 10 metrics per report, so full coverage means one report per
// dimension with metrics chunked — hundreds of calls on a large property.
// These pin down the rules that decide what those calls are.

describe('task planning', () => {
  it('chunks metrics at the API ceiling of ten', () => {
    const tasks = buildTasks(['deviceCategory'], Array.from({ length: 12 }, (_, i) => `m${i}`));
    expect(tasks).toHaveLength(2);
    expect(tasks[0].metrics).toHaveLength(10);
    expect(tasks[1].metrics).toHaveLength(2);
  });

  it('drops nothing — this replaces a cap that silently discarded dimensions', () => {
    const dimensions = Array.from({ length: 120 }, (_, i) => `dim${i}`);
    const tasks = buildTasks(dimensions, ['sessions']);
    expect(tasks).toHaveLength(120);
    expect(new Set(tasks.map((task) => task.dimension)).size).toBe(120);
  });

  it('excludes time dimensions, since every report is already grouped by date', () => {
    expect(buildTasks(['date', 'year', 'hour', 'deviceCategory'], ['sessions']).map((t) => t.dimension))
      .toEqual(['deviceCategory']);
  });

  it('collapses duplicates and plans nothing for empty input', () => {
    expect(buildTasks(['a', 'a', 'b'], ['m', 'm'])).toHaveLength(2);
    expect(buildTasks([], ['m'])).toEqual([]);
    expect(buildTasks(['a'], [])).toEqual([]);
  });

  it('estimates the request count accurately', () => {
    const estimate = estimateRequests(
      Array.from({ length: 50 }, (_, i) => `d${i}`),
      Array.from({ length: 20 }, (_, i) => `m${i}`)
    );
    expect(estimate.reports).toBe(100);
    expect(estimate.batches).toBe(20);
  });
});

describe('row limits scale with cardinality', () => {
  it('gives pages the most room and low-cardinality dimensions the least', () => {
    expect(rowLimitFor('landingPagePlusQueryString')).toBeGreaterThanOrEqual(1000);
    expect(rowLimitFor('country')).toBe(500);
    expect(rowLimitFor('deviceCategory')).toBe(200);
    expect(rowLimitFor('customEvent:plan_tier')).toBeGreaterThanOrEqual(500);
  });
});

describe('metric names', () => {
  it('maps keyEvents and legacy conversions to one canonical name', () => {
    expect(normaliseMetricName('keyEvents')).toBe('conversions');
    expect(normaliseMetricName('conversions')).toBe('conversions');
  });

  it('converts camelCase and strips custom prefixes', () => {
    expect(normaliseMetricName('activeUsers')).toBe('active_users');
    expect(normaliseMetricName('someNewMetric')).toBe('some_new_metric');
    expect(normaliseMetricName('customEvent:planTier')).toBe('plan_tier');
  });
});

describe('row merging across metric chunks', () => {
  it('merges chunks for the same day and entity into one row', () => {
    // Without this the same entity on the same day becomes several partial
    // rows, which then sum incorrectly downstream.
    const bucket = new Map();
    mergeRows(bucket, ['sessions', 'activeUsers'], [
      { dimensionValues: [{ value: '20260806' }, { value: 'Organic' }], metricValues: [{ value: '100' }, { value: '80' }] },
    ]);
    mergeRows(bucket, ['totalRevenue'], [
      { dimensionValues: [{ value: '20260806' }, { value: 'Organic' }], metricValues: [{ value: '4200' }] },
    ]);
    expect(bucket.size).toBe(1);
    expect([...bucket.values()][0].metrics).toEqual({ sessions: 100, active_users: 80, revenue: 4200 });
  });

  it('keeps different entities and different days apart', () => {
    const bucket = new Map();
    mergeRows(bucket, ['sessions'], [
      { dimensionValues: [{ value: '20260806' }, { value: 'Organic' }], metricValues: [{ value: '100' }] },
      { dimensionValues: [{ value: '20260806' }, { value: 'Paid' }], metricValues: [{ value: '50' }] },
      { dimensionValues: [{ value: '20260807' }, { value: 'Organic' }], metricValues: [{ value: '120' }] },
    ]);
    expect(bucket.size).toBe(3);
  });

  it('discards (other) in the date slot rather than storing it as a date', () => {
    const bucket = new Map();
    mergeRows(bucket, ['sessions'], [
      { dimensionValues: [{ value: '(other)' }, { value: 'X' }], metricValues: [{ value: '9' }] },
      { dimensionValues: [{ value: '20260806' }, { value: 'X' }], metricValues: [{ value: '9' }] },
    ]);
    expect(bucket.size).toBe(1);
  });

  it('labels an empty dimension value and coerces bad numbers to zero', () => {
    const bucket = new Map();
    mergeRows(bucket, ['sessions'], [
      { dimensionValues: [{ value: '20260806' }, { value: '' }], metricValues: [{ value: 'oops' }] },
    ]);
    const row = [...bucket.values()][0];
    expect(row.value).toBe('(not set)');
    expect(row.metrics.sessions).toBe(0);
  });
});

describe('pagination', () => {
  const task = { dimension: 'a', metrics: ['m'], offset: 0, limit: 200 };

  it('continues while rows remain and stops at the end', () => {
    expect(shouldPaginate(task, 200, 950)).toBe(true);
    expect(shouldPaginate({ ...task, offset: 800 }, 150, 950)).toBe(false);
    expect(shouldPaginate(task, 0, 950)).toBe(false);
  });

  it('has a hard ceiling so a runaway dimension cannot loop forever', () => {
    expect(shouldPaginate({ ...task, offset: 100_000 }, 200, 9e9)).toBe(false);
  });
});

describe('entity types', () => {
  it('keeps stable types for known dimensions and namespaces the rest', () => {
    expect(entityTypeFor('sessionDefaultChannelGroup')).toBe('channel');
    expect(entityTypeFor('landingPagePlusQueryString')).toBe('landing_page');
    expect(entityTypeFor('browser')).toBe('dim:browser');
    expect(entityTypeFor('customEvent:plan')).toContain('custom:');
  });
});
