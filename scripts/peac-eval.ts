#!/usr/bin/env tsx
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { evaluateConditionForTest, loadConfig, type Dict } from '../src/peac.js';
import { createFixtureEnvelope, generateArtifact } from '../src/runtime-authority-api.js';
import { validatorDefinitions } from '../src/runtime-authority-plan.js';

interface RubricCheck {
  id: string;
  domain?: string;
  subtype?: string;
  required_substrings?: string[];
  forbidden_substrings?: string[];
  expected_routing_method?: string;
  expected_contract_source?: string;
  expected_template_path?: string;
  required_rule_ids?: string[];
  required_validator_ids?: string[];
}
interface RubricFile { rubric_id: string; checks: RubricCheck[] }
interface CaseFile { expected?: { validation?: { should_pass?: boolean } } }

function walkCases(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkCases(path));
    if (entry.isFile() && path.replaceAll('\\', '/').includes('/cases/') && path.endsWith('.yaml')) result.push(path);
  }
  return result.sort();
}
function caseSkipReason(caseFile: string): string | null {
  const data = yaml.load(readFileSync(caseFile, 'utf8')) as CaseFile | null;
  return data?.expected?.validation?.should_pass === false ? 'expected.validation.should_pass=false' : null;
}
function loadRubrics(): RubricFile[] {
  try { return readdirSync('evals').filter((file) => file.endsWith('.yaml')).sort().map((file) => yaml.load(readFileSync(join('evals', file), 'utf8')) as RubricFile).filter(Boolean); }
  catch { return []; }
}
function record(value: unknown): Dict { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {}; }
function arrayOfRecords(value: unknown): Dict[] { return Array.isArray(value) ? value.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) as Dict[] : []; }
function normalizedPath(value: unknown): string { return String(value ?? '').replaceAll('\\', '/'); }

const config = loadConfig();

function assertCanonicalEvidence(caseFile: string, payload: Dict, failures: string[]): void {
  const derived = record(payload.derived_projection);
  const routing = record(derived.routing);
  const plan = record(derived.generationPlan);
  const contract = record(plan.contract);
  const resolvedInputs = record(contract.resolved_inputs);
  const applicableRules = arrayOfRecords(record(plan.rules).applicable);
  const ledger = arrayOfRecords(derived.validationLedger);
  const identity = record(payload.canonical_prompt_identity);
  const provenance = record(payload.provenance);
  const domain = String(payload.domain ?? '');
  const subtype = payload.subtype === null ? null : String(payload.subtype ?? '');
  if (!domain || domain !== String(routing.domain ?? '')) failures.push(`${caseFile}: canonical routing Domain mismatch`);
  if (subtype !== (routing.subtype === null ? null : String(routing.subtype ?? ''))) failures.push(`${caseFile}: canonical routing Subtype mismatch`);
  if (!String(routing.method ?? '').trim()) failures.push(`${caseFile}: routing method is missing`);
  if (!String(contract.source_path ?? '').trim() || !String(contract.source_sha256 ?? '').trim()) failures.push(`${caseFile}: contract provenance is incomplete`);
  for (const rule of applicableRules) if (rule.execution_result !== 'applied') failures.push(`${caseFile}: applicable rule was not applied: ${String(rule.rule_id ?? '<missing>')}`);
  for (const definition of validatorDefinitions(config, domain).checks) {
    const validatorId = String(definition.id ?? 'unnamed_check');
    const observed = ledger.find((item) => String(item.check_id ?? '') === validatorId);
    if (!observed) {
      failures.push(`${caseFile}: validator ledger record is missing: ${validatorId}`);
      continue;
    }
    let expectedApplicable = true;
    try {
      expectedApplicable = definition.applies_when === undefined || evaluateConditionForTest(String(definition.applies_when), resolvedInputs);
    } catch (error) {
      failures.push(`${caseFile}: validator applicability evaluation failed for ${validatorId}: ${(error as Error).message}`);
      continue;
    }
    if (observed.applicable !== expectedApplicable) failures.push(`${caseFile}: validator applicability mismatch: ${validatorId}`);
    if (expectedApplicable && observed.executed !== true) failures.push(`${caseFile}: applicable validator did not execute: ${validatorId}`);
    if (!expectedApplicable && observed.executed !== false) failures.push(`${caseFile}: non-applicable validator executed: ${validatorId}`);
  }
  const templatePath = normalizedPath(identity.templatePath);
  if (!templatePath) failures.push(`${caseFile}: canonical template identity is missing`);
  if (templatePath !== normalizedPath(provenance.template_used)) failures.push(`${caseFile}: template provenance differs from canonical identity`);
  const sources = arrayOfRecords(derived.governingSources).map((source) => normalizedPath(source.path));
  if (templatePath && !sources.includes(templatePath)) failures.push(`${caseFile}: canonical template is absent from governing sources`);
}

const rubrics = loadRubrics();
if (rubrics.length === 0) { console.log('No PEaC rubrics found. Add evals/*.yaml to enable local rubric checks.'); process.exit(0); }
const failures: string[] = [];
const skippedByReason = new Map<string, number>();
let checksRun = 0;
let generated = 0;
for (const caseFile of walkCases(config.domains_path)) {
  const skipReason = caseSkipReason(caseFile);
  if (skipReason) { skippedByReason.set(skipReason, (skippedByReason.get(skipReason) ?? 0) + 1); continue; }
  let outputPath: string | null = null;
  try {
    const result = generateArtifact(createFixtureEnvelope(caseFile), 'ci');
    outputPath = result.outputPath;
    const payload = result.artifact.artifact as Dict;
    generated += 1;
    assertCanonicalEvidence(caseFile, payload, failures);
    const renderedPrompt = String(payload.rendered_prompt ?? '');
    const derived = record(payload.derived_projection);
    const routing = record(derived.routing);
    const plan = record(derived.generationPlan);
    const contract = record(plan.contract);
    const rules = arrayOfRecords(record(plan.rules).applicable);
    const ledger = arrayOfRecords(derived.validationLedger);
    const identity = record(payload.canonical_prompt_identity);
    for (const rubric of rubrics) for (const check of rubric.checks ?? []) {
      if (check.domain && check.domain !== payload.domain) continue;
      if (check.subtype && check.subtype !== payload.subtype) continue;
      checksRun += 1;
      for (const needle of check.required_substrings ?? []) if (!renderedPrompt.includes(needle)) failures.push(`${caseFile}: ${rubric.rubric_id}/${check.id} missing ${needle}`);
      for (const needle of check.forbidden_substrings ?? []) if (renderedPrompt.includes(needle)) failures.push(`${caseFile}: ${rubric.rubric_id}/${check.id} contains forbidden ${needle}`);
      if (check.expected_routing_method && check.expected_routing_method !== routing.method) failures.push(`${caseFile}: ${rubric.rubric_id}/${check.id} routing method mismatch`);
      if (check.expected_contract_source && normalizedPath(check.expected_contract_source) !== normalizedPath(contract.source_path)) failures.push(`${caseFile}: ${rubric.rubric_id}/${check.id} contract source mismatch`);
      if (check.expected_template_path && normalizedPath(check.expected_template_path) !== normalizedPath(identity.templatePath)) failures.push(`${caseFile}: ${rubric.rubric_id}/${check.id} template path mismatch`);
      for (const ruleId of check.required_rule_ids ?? []) if (!rules.find((item) => String(item.rule_id ?? '') === ruleId && item.execution_result === 'applied')) failures.push(`${caseFile}: ${rubric.rubric_id}/${check.id} missing applied rule ${ruleId}`);
      for (const validatorId of check.required_validator_ids ?? []) if (!ledger.find((item) => String(item.check_id ?? '') === validatorId && item.applicable === true && item.executed === true)) failures.push(`${caseFile}: ${rubric.rubric_id}/${check.id} missing executed validator ${validatorId}`);
    }
  } catch (error) { failures.push(`${caseFile}: canonical generation failed: ${(error as Error).message}`); }
  finally { if (outputPath) rmSync(outputPath, { force: true }); }
}
if (failures.length > 0) { console.error(`PEaC canonical rubric evaluation failed: ${failures.length}`); for (const failure of failures) console.error(`- ${failure}`); process.exit(1); }
const skipped = [...skippedByReason.entries()].sort().map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none';
console.log(`PEaC canonical rubric evaluation passed with ${rubrics.length} rubric file(s), ${generated} generated case(s), ${checksRun} check application(s), and explicit skips: ${skipped}.`);
