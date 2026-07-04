#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

type Dict = Record<string, unknown>;
type CaseFile = { case_id?: string; inputs?: Dict; expected?: { validation?: { should_pass?: boolean } } };
const INVALID_ROOT = 'tests/production-grade-gate/invalid';

function files(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(path));
    else out.push(path);
  }
  return out;
}

function load(path: string): Dict {
  return (yaml.load(readFileSync(path, 'utf8')) as Dict | null) ?? {};
}

function values(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

function isExpectedFailure(data: Dict): boolean {
  const expected = data.expected as CaseFile['expected'] | undefined;
  return expected?.validation?.should_pass === false;
}

function subject(data: Dict): Dict {
  return data.inputs && typeof data.inputs === 'object' ? data.inputs as Dict : data;
}

function checkProductionGradeRecord(path: string): string[] {
  const data = load(path);
  if (isExpectedFailure(data)) return [];
  const input = subject(data);
  if (input.strictness !== 'production-grade') return [];
  const failures: string[] = [];
  if (values(input.success_criteria).length === 0) failures.push(`${path}: production-grade requires non-empty success_criteria`);
  if (values(input.failure_modes).length === 0) failures.push(`${path}: production-grade requires non-empty failure_modes`);
  if (values(input.eval_suite).length === 0) failures.push(`${path}: production-grade requires non-empty eval_suite`);
  return failures;
}

function productionInputs(): string[] {
  return [
    ...files('domains').filter((path) => path.replaceAll('\\', '/').includes('/cases/') && path.endsWith('.yaml')),
    ...files('intakes/valid').filter((path) => path.endsWith('.yaml'))
  ];
}

const failures = productionInputs().flatMap(checkProductionGradeRecord);
let invalidFixtures = 0;
for (const fixture of files(INVALID_ROOT).filter((path) => path.endsWith('.yaml'))) {
  invalidFixtures += 1;
  const fixtureFailures = checkProductionGradeRecord(fixture);
  if (fixtureFailures.length === 0) failures.push(`${fixture}: expected production-grade gate fixture to fail, but it passed`);
}

if (failures.length > 0) {
  console.error(`PEaC production-grade gate failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PEaC production-grade gate passed for ${productionInputs().length} production input file(s) and ${invalidFixtures} invalid fixture(s).`);
