#!/usr/bin/env tsx
import { evaluateConditionForTest } from '../src/peac.js';

function assertEqual(name: string, actual: boolean, expected: boolean): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${actual}`);
  }
}

assertEqual(
  'string literals with reserved words are safe',
  evaluateConditionForTest("style_description == 'first class'", { style_description: 'first class' }),
  true
);

assertEqual(
  'array length condition works',
  evaluateConditionForTest('overlay_elements.length > 0 || logo_required == true', { overlay_elements: ['logo'], logo_required: false }),
  true
);

assertEqual(
  'boolean and grouping work',
  evaluateConditionForTest("!(subject_count == 0) && domain == 'image'", { subject_count: 1, domain: 'image' }),
  true
);

assertEqual(
  'unknown array length is safe false',
  evaluateConditionForTest('missing_list.length > 0', {}),
  false
);

let invalidExpressionFailed = false;
try {
  evaluateConditionForTest('subject_count >', { subject_count: 1 });
} catch {
  invalidExpressionFailed = true;
}

assertEqual('invalid expressions fail closed', invalidExpressionFailed, true);

console.log('PEaC self tests passed.');
