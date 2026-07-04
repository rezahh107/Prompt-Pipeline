#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

type Dict = Record<string, unknown>;
type CaseFile = { case_id?: string; inputs?: Dict; expected?: { validation?: { should_pass?: boolean } } };
type RubricFile = { rubric_id?: string; checks?: Array<{ id?: string }> };
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

function rubricChecks(): Set<string> {
  const result = new Set<string>();
  for (const file of files('evals').filter((path) => path.endsWith('.yaml') || path.endsWith('.yml'))) {
    const rubric = load(file) as RubricFile;
    if (!rubric.rubric_id) continue;
    for (const check of rubric.checks ?? []) if (check.id) result.add(`${rubric.rubric_id}/${check.id}`);
  }
  return result;
}

const RESOLVED_EVALS = rubricChecks();

function checkEvalSuite(path: string, evalSuite: string[]): string[] {
  const failures: string[] = [];
  for (const id of evalSuite) {
    if (!id.includes('/')) failures.push(`${path}: eval_suite id must use rubric_id/check_id format: ${id}`);
    else if (!RESOLVED_EVALS.has(id)) failures.push(`${path}: eval_suite id does not resolve to evals/*.yaml: ${id}`);
  }
  return failures;
}

export function checkProductionGradeRecord(path: string): string[] {
  const data = load(path);
  if (isExpectedFailure(data)) return [];
  const input = subject(data);
  if (input.strictness !== 'production-grade') return [];
  const failures: string[] = [];
  const successCriteria = values(input.success_criteria);
  const failureModes = values(input.failure_modes);
  const evalSuite = values(input.eval_suite);
  if (successCriteria.length === 0) failures.push(`${path}: production-grade requires non-empty success_criteria`);
  if (failureModes.length === 0) failures.push(`${path}: production-grade requires non-empty failure_modes`);
  if (evalSuite.length === 0) failures.push(`${path}: production-grade requires non-empty eval_suite`);
  failures.push(...checkEvalSuite(path, evalSuite));
  return failures;
}

function productionInputs(): string[] {
  return [
    ...files('domains').filter((path) => path.replaceAll('\\', '/').includes('/cases/') && !path.replaceAll('\\', '/').includes('/cases/invalid/') && path.endsWith('.yaml')),
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
