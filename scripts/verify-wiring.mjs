#!/usr/bin/env node
// Wiring assertions.
//
// Three times a string replacement matched nothing, returned the input
// unchanged, and reported success anyway — leaving a feature built, tested
// and completely unreachable. These check the seams are actually connected,
// which a type check cannot tell you: passing four arguments instead of five
// is valid TypeScript when the fifth is optional.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const checks = [
  {
    name: 'sync passes the user-selected fields to the adapter',
    file: 'backend/src/modules/connectors/connector.service.ts',
    must: ['enabledFields(connector.id)', 'windowDays, range, selected)'],
  },
  {
    name: 'GA4 sync consumes the selected fields',
    file: 'backend/src/modules/connectors/ga4/ga4Connector.ts',
    must: ['selected?.dimensions', 'selected?.metrics', 'buildTasks('],
  },
  {
    name: 'GA4 reports its schema for the field catalogue',
    file: 'backend/src/modules/connectors/ga4/ga4Connector.ts',
    must: ['async describeSchema', 'customDefinition'],
  },
  {
    name: 'field discovery runs when a connector is created',
    file: 'backend/src/modules/connectors/connector.routes.ts',
    must: ['discoverFields(connector.id)'],
  },
  {
    name: 'inserts are chunked below the Postgres parameter ceiling',
    file: 'backend/src/modules/connectors/connector.service.ts',
    must: ['INSERT_CHUNK', 'slice(i, i + INSERT_CHUNK)'],
  },
  {
    name: 'the prompt data builder emits its table',
    file: 'backend/src/modules/chat/visualBuilder.ts',
    must: ['const lines: string[]', 'promptRows.map('],
  },
  {
    name: 'answers are grounded against the data before being shown',
    file: 'backend/src/modules/chat/chatOrchestrator.ts',
    must: ['checkGrounding(', 'buildAdmissibleValues('],
  },
  {
    name: 'visuals are built only when the presentation logic allows',
    file: 'backend/src/modules/chat/chatOrchestrator.ts',
    must: ['presentation.showChart ? buildChart', 'presentation.showTable ? buildTable'],
  },
  {
    name: 'the reader persona reaches the prompt',
    file: 'backend/src/modules/chat/chatOrchestrator.ts',
    must: ['personaGuidance('],
  },
  {
    name: 'generation state is set and cleared around the model call',
    file: 'backend/src/modules/chat/chatOrchestrator.ts',
    must: ['generatingSince: new Date()', 'generatingSince: null'],
  },
];

let failed = 0;
for (const check of checks) {
  let source = '';
  try {
    source = readFileSync(resolve(root, check.file), 'utf8');
  } catch {
    console.log(`FAIL  ${check.name}\n      missing file: ${check.file}`);
    failed++;
    continue;
  }
  const missing = check.must.filter((needle) => !source.includes(needle));
  if (missing.length) {
    console.log(`FAIL  ${check.name}\n      not found in ${check.file}: ${missing.join(', ')}`);
    failed++;
  } else {
    console.log(`ok    ${check.name}`);
  }
}

console.log(failed ? `\n${failed} wiring check(s) failed.` : `\nAll ${checks.length} wiring checks passed.`);
process.exit(failed ? 1 : 0);
