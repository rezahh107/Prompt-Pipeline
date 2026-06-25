#!/usr/bin/env tsx
import { validateAllCases } from '../src/peac.js';

const result = validateAllCases();
console.log(`PEaC static validation: ${result.passed}/${result.total} cases passed`);
if (result.failed > 0) {
  for (const failure of result.failures) console.error(`- ${failure}`);
  process.exit(1);
}
