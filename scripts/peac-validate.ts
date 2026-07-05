#!/usr/bin/env tsx
import { validateAllCases } from '../src/peac.js';
import { validateContextCaseFiles } from './peac-context-case-check.js';

const result = validateAllCases();
const contextResult = validateContextCaseFiles();
console.log(`PEaC static validation: ${result.passed}/${result.total} cases passed`);
console.log(`PEaC context case validation: ${contextResult.total - contextResult.failed}/${contextResult.total} cases passed`);
const failures = [...result.failures, ...contextResult.failures];
if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
