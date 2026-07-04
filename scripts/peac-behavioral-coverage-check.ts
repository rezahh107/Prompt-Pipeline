#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs';
import yaml from 'js-yaml';

type Risk = 'low' | 'medium' | 'high' | 'critical';
type CoverageStatus = 'validator_backed' | 'fixture_tested' | 'ci_enforced_lite' | 'tracked_gap';

interface CoverageBlock {
  schema_carriers?: string[];
  validator_rules?: string[];
  rubric_checks?: string[];
  valid_fixtures?: string[];
  invalid_fixtures?: string[];
  ci_steps?: string[];
  downstream_contracts?: string[];
}

interface BehavioralRule {
  rule_id?: string;
  title?: string;
  risk?: Risk;
  source_refs?: string[];
  coverage?: CoverageBlock;
  coverage_status?: CoverageStatus;
  next_hardening?: string[];
}

interface CoverageFile {
  version?: string;
  purpose?: string;
  rules?: BehavioralRule[];
}

const COVERAGE_PATH = 'pipeline/behavioral-rule-coverage.yaml';
const ALLOWED_RISKS = new Set<Risk>(['low', 'medium', 'high', 'critical']);
const ALLOWED_STATUSES = new Set<CoverageStatus>(['validator_backed', 'fixture_tested', 'ci_enforced_lite', 'tracked_gap']);
const HIGH_RISKS = new Set<Risk>(['high', 'critical']);

function pathFromRef(ref: string): string {
  const index = ref.indexOf('#');
  return index >= 0 ? ref.slice(0, index) : ref;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function hasAnyCoverage(coverage: CoverageBlock): boolean {
  return [
    coverage.schema_carriers,
    coverage.validator_rules,
    coverage.rubric_checks,
    coverage.valid_fixtures,
    coverage.invalid_fixtures,
    coverage.ci_steps,
    coverage.downstream_contracts
  ].some((items) => list(items).length > 0);
}

function assertFixturePaths(rule: BehavioralRule, failures: string[]): void {
  for (const key of ['valid_fixtures', 'invalid_fixtures'] as const) {
    for (const fixture of list(rule.coverage?.[key])) {
      if (!existsSync(fixture)) failures.push(`${rule.rule_id}: missing ${key} file ${fixture}`);
    }
  }
}

function assertSourceRefs(rule: BehavioralRule, failures: string[]): void {
  for (const ref of list(rule.source_refs)) {
    const filePath = pathFromRef(ref);
    if (!filePath) failures.push(`${rule.rule_id}: empty source_ref ${ref}`);
    else if (!existsSync(filePath)) failures.push(`${rule.rule_id}: source_ref file does not exist: ${filePath}`);
  }
}

function validateRule(rule: BehavioralRule, index: number, failures: string[]): void {
  const label = rule.rule_id ?? `rules[${index}]`;
  if (!rule.rule_id) failures.push(`${label}: missing rule_id`);
  if (!rule.title) failures.push(`${label}: missing title`);
  if (!rule.risk || !ALLOWED_RISKS.has(rule.risk)) failures.push(`${label}: invalid or missing risk`);
  if (!rule.coverage_status || !ALLOWED_STATUSES.has(rule.coverage_status)) failures.push(`${label}: invalid or missing coverage_status`);
  if (list(rule.source_refs).length === 0) failures.push(`${label}: missing source_refs`);
  if (!rule.coverage || typeof rule.coverage !== 'object') failures.push(`${label}: missing coverage block`);

  if (rule.source_refs) assertSourceRefs(rule, failures);
  if (rule.coverage) assertFixturePaths(rule, failures);

  if (rule.risk && HIGH_RISKS.has(rule.risk)) {
    if (!rule.coverage || !hasAnyCoverage(rule.coverage)) failures.push(`${label}: high/critical rule has no coverage carrier`);
    if (rule.coverage_status === 'tracked_gap' && list(rule.next_hardening).length === 0) failures.push(`${label}: tracked_gap requires next_hardening`);
    if (rule.coverage_status === 'fixture_tested') {
      const hasFixture = list(rule.coverage?.valid_fixtures).length > 0 || list(rule.coverage?.invalid_fixtures).length > 0;
      if (!hasFixture) failures.push(`${label}: fixture_tested requires at least one fixture`);
    }
    if (rule.coverage_status === 'validator_backed') {
      const hasValidator = list(rule.coverage?.validator_rules).length > 0 || list(rule.coverage?.rubric_checks).length > 0;
      if (!hasValidator) failures.push(`${label}: validator_backed requires validator_rules or rubric_checks`);
    }
  }
}

if (!existsSync(COVERAGE_PATH)) {
  console.error(`Missing behavioral coverage file: ${COVERAGE_PATH}`);
  process.exit(1);
}

const data = yaml.load(readFileSync(COVERAGE_PATH, 'utf8')) as CoverageFile | null;
const failures: string[] = [];
if (!data || typeof data !== 'object') failures.push(`${COVERAGE_PATH}: invalid YAML object`);
if (!data?.version) failures.push(`${COVERAGE_PATH}: missing version`);
if (!data?.purpose) failures.push(`${COVERAGE_PATH}: missing purpose`);
if (!Array.isArray(data?.rules) || data.rules.length === 0) failures.push(`${COVERAGE_PATH}: missing rules`);

for (const [index, rule] of (data?.rules ?? []).entries()) validateRule(rule, index, failures);

if (failures.length > 0) {
  console.error(`PEaC behavioral coverage check failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PEaC behavioral coverage check passed for ${data?.rules?.length ?? 0} rule(s).`);
