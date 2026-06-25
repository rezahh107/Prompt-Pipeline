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
  'loose null equality treats undefined as nullish',
  evaluateConditionForTest('missing_value == null', {}),
  true
);

assertEqual(
  'loose null inequality treats provided value as non-nullish',
  evaluateConditionForTest('present_value != null', { present_value: 'x' }),
  true
);

assertThrows('unterminated string literals fail closed', () => {
  evaluateConditionForTest("style_description == '", { style_description: '' });
});

console.log('PEaC self tests passed.');
