import { parseFormula, extractIdentifiers, evaluateNode, FormulaError } from './formula';

// Pure custom-metric evaluation — no database import, so it is directly
// unit-testable. The service layer that persists and validates metrics
// against a workspace lives in ./customMetric.service.ts.

export interface MetricDefinition {
  name: string;
  formula: string;
}

/**
 * Given one row's canonical metrics, compute every custom metric and merge
 * the results in. Custom metrics may reference each other, so resolution
 * is dependency-driven rather than array-order-driven: a metric defined
 * first can still depend on one defined later.
 */
export function applyCustomMetrics(
  baseMetrics: Record<string, number>,
  customMetrics: MetricDefinition[]
): Record<string, number> {
  const formulasByName = new Map(customMetrics.map((m) => [m.name, m.formula]));
  const resolved: Record<string, number> = { ...baseMetrics };
  const resolving = new Set<string>();

  function resolve(name: string): number {
    if (name in resolved) return resolved[name];
    if (resolving.has(name)) throw new FormulaError(`Circular reference while evaluating "${name}"`);

    const formula = formulasByName.get(name);
    if (!formula) throw new FormulaError(`Unknown metric "${name}"`);

    resolving.add(name);
    const node = parseFormula(formula);
    const variables: Record<string, number> = {};
    for (const id of extractIdentifiers(formula)) {
      variables[id] = id in resolved ? resolved[id] : resolve(id);
    }
    const value = evaluateNode(node, variables);
    resolving.delete(name);
    resolved[name] = value;
    return value;
  }

  for (const metric of customMetrics) resolve(metric.name);
  return resolved;
}
