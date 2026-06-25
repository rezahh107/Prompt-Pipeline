#!/usr/bin/env tsx
import { evaluateConditionForTest } from '../src/peac.js';

function assertEqual(name: string, actual: boolean, expected: boolean): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${actual}`);
  }
}

function assertThrows(name: string, fn: () => void): void {
  let didThrow = false;
  try {
    fn();
  } catch {
    didThrow = true;
  }
  if (!didThrow) throw new Error(`${name}: expected an error`);
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

assertEqual(
  'loose null equality treats undefined as nullish',
  evaluateConditionForTest('missing_value == null', {}),
  true
);

assertEqual(
  'loose null inequality treats provided value as non-nullish',
  evaluateConditionForTest('present_value != null', { present_value: 'x' }),
  true
);

assertThrows('invalid expressions fail closed', () => {
  evaluateConditionForTest('subject_count >', { subject_count: 1 });
});

assertThrows('unterminated string literals fail closed', () => {
  evaluateConditionForTest("style_description == '", { style_description: '' });
});

console.log('PEaC self tests passed.');
