import { prisma } from '../../infra';
import { extractIdentifiers, parseFormula, FormulaError } from './formula';
import { applyCustomMetrics } from './resolve';

// Re-exported so callers keep importing it from the service; the
// implementation is in ./resolve.ts, which has no database dependency.
export { applyCustomMetrics };

// Canonical metric keys that can appear in a formula without being another
// custom metric. Kept in sync with what connector.service.ts's canonical
// schema actually produces (connector.types.ts's CanonicalMetrics) plus a
// couple of common ratios that show up across connectors.
export const CANONICAL_METRIC_KEYS = [
  'impressions', 'clicks', 'cost', 'conversions', 'conversion_value',
  'sessions', 'active_users', 'revenue',
];

async function detectCycle(workspaceId: string, candidateName: string, candidateFormula: string) {
  const existing = await prisma.customMetric.findMany({ where: { workspaceId } });
  const formulasByName = new Map<string, string>(existing.map((m) => [m.name, m.formula]));
  formulasByName.set(candidateName, candidateFormula); // overlay the metric being saved

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string, path: string[]) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new FormulaError(`Circular reference detected: ${[...path, name].join(' -> ')}`);
    }
    const formula = formulasByName.get(name);
    if (!formula) return; // not a custom metric -> must be a canonical key, nothing to recurse into

    visiting.add(name);
    for (const ref of extractIdentifiers(formula)) {
      if (formulasByName.has(ref)) visit(ref, [...path, name]);
    }
    visiting.delete(name);
    visited.add(name);
  }

  visit(candidateName, []);
}

export async function createCustomMetric(workspaceId: string, name: string, formula: string) {
  // Validate syntax and that every referenced identifier resolves to
  // something real (a canonical key or another custom metric on this
  // workspace) before ever touching the database.
  parseFormula(formula); // throws FormulaError on bad syntax
  const identifiers = extractIdentifiers(formula);
  const existingNames = new Set((await prisma.customMetric.findMany({ where: { workspaceId }, select: { name: true } })).map((m) => m.name));

  for (const id of identifiers) {
    if (!CANONICAL_METRIC_KEYS.includes(id) && !existingNames.has(id) && id !== name) {
      throw new FormulaError(`"${id}" is not a known metric or custom metric on this workspace`);
    }
  }

  await detectCycle(workspaceId, name, formula);

  return prisma.customMetric.create({ data: { workspaceId, name, formula } });
}

export async function listCustomMetrics(workspaceId: string) {
  return prisma.customMetric.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
}

export async function deleteCustomMetric(workspaceId: string, id: string) {
  return prisma.customMetric.deleteMany({ where: { id, workspaceId } });
}
