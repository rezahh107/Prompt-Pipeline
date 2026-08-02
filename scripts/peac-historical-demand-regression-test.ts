#!/usr/bin/env tsx
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadConfig, type Dict, type PEaCConfig } from '../src/peac.js';
import {
  compileRuntimePlan,
  createValidatedIntakeEnvelope,
  generateArtifact,
  sha256Json,
  verifyRuntimeArtifact,
} from '../src/runtime-authority-api.js';
import { delegatedTargetFromPlan } from '../src/runtime-authority-delegation.js';

const REQUIRED_IDS = [
  'D-01-DELEGATED-REPOSITORY-AUDIT',
  'D-02-DIRECT-REPOSITORY-AUDIT',
  'D-03-DELEGATED-PR-CRITIQUE',
  'D-04-DELEGATED-CODE-REVIEW',
  'D-05-DIRECT-CODE-REVIEW',
  'D-06-DELEGATED-DEBUGGING',
  'D-07-DELEGATED-DOCUMENT-REVIEW',
  'D-08-DELEGATED-IMAGE-PROMPT',
  'D-09-GENERIC-LOW-RISK-PROMPT',
  'D-10-REFACTOR-EXISTING-REPOSITORY-AUDIT-PROMPT',
  'D-11-UNRESOLVED-TARGET',
  'D-12-MISSING-TARGET-CONTRACT-INPUTS',
  'D-13-RECURSIVE-TARGET-ROUTE',
  'D-14-HIGH-RISK-DELEGATED-TARGET',
  'D-15-TARGET-TEMPLATE-PROVENANCE-MUTATION',
] as const;

let passed = 0;
const failures: string[] = [];
const generatedPaths: string[] = [];

function record(value: unknown): Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {};
}

function records(value: unknown): Dict[] {
  return Array.isArray(value)
    ? value.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) as Dict[]
    : [];
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function normalizePath(value: unknown): string {
  return String(value ?? '').replaceAll('\\', '/');
}

function riskRank(value: unknown): number {
  const risk = String(value);
  if (risk === 'clarification_required' || risk === 'unknown') return 5;
  if (risk === 'high') return 4;
  if (risk === 'medium') return 3;
  if (risk === 'low') return 1;
  return 0;
}

function test(id: string, operation: () => void): void {
  try {
    operation();
    passed += 1;
  } catch (error) {
    failures.push(`${id}: ${(error as Error).message}`);
  }
}

function baseIntake(request: string, overrides: Dict): Dict {
  return {
    request,
    desired_output: 'copy-ready prompt',
    target_environment: 'ChatGPT',
    strictness: 'precise',
    constraints: [],
    available_sources: [],
    requested_actions: [],
    sensitive_or_high_risk: false,
    uses_external_tools: false,
    legal_medical_financial: false,
    requires_current_information: false,
    exact_factual_claims: false,
    external_files: false,
    requires_structured_output: true,
    potential_downstream_execution: false,
    ...overrides,
  };
}

const corpusPath = resolve('tests/runtime/historical-demand-regression.v1.yaml');
const corpus = record(yaml.load(readFileSync(corpusPath, 'utf8')));
expect(corpus.schema_version === 'historical-demand-regression.v1', 'Historical-demand corpus schema version is invalid.');
const cases = records(corpus.cases);
expect(cases.length === REQUIRED_IDS.length, `Expected ${REQUIRED_IDS.length} historical-demand fixtures, got ${cases.length}.`);
const observedIds = cases.map((item) => String(item.id));
expect(new Set(observedIds).size === observedIds.length, 'Historical-demand fixture IDs must be unique.');
expect(REQUIRED_IDS.every((id) => observedIds.includes(id)), 'Historical-demand corpus is missing one or more required fixture IDs.');
for (const category of ['positive', 'negative', 'boundary']) {
  expect(cases.some((item) => item.category === category), `Historical-demand corpus has no ${category} fixture.`);
}

const baseConfig = loadConfig();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'peac-phase-d-'));
const config: PEaCConfig = {
  ...baseConfig,
  domains_path: join(temporaryRoot, 'domains'),
  pipeline_path: join(temporaryRoot, 'pipeline'),
  policies_path: join(temporaryRoot, 'policies'),
  outputs_path: join(temporaryRoot, 'outputs'),
  artifact: {
    ...baseConfig.artifact,
    schema: join(temporaryRoot, 'pipeline', 'artifact.schema.json'),
    output_dir: join(temporaryRoot, 'outputs'),
  },
};
cpSync(baseConfig.domains_path, config.domains_path, { recursive: true });
cpSync(baseConfig.pipeline_path, config.pipeline_path, { recursive: true });
cpSync(baseConfig.policies_path, config.policies_path, { recursive: true });

function rawIntake(fixture: Dict): Dict {
  return baseIntake(String(fixture.request ?? ''), record(fixture.inputs));
}

function compileFixture(fixture: Dict) {
  return compileRuntimePlan(createValidatedIntakeEnvelope(rawIntake(fixture), 'api_request', config), config);
}

function assertPlan(fixture: Dict, plan: ReturnType<typeof compileFixture>): void {
  const expected = record(fixture.expected);
  if (expected.outer_domain !== undefined) {
    expect(plan.routing.domain === expected.outer_domain, `expected outer Domain ${String(expected.outer_domain)}, got ${plan.routing.domain}`);
  }
  if (expected.outer_subtype !== undefined) {
    expect(plan.routing.subtype === expected.outer_subtype, `expected outer Subtype ${String(expected.outer_subtype)}, got ${String(plan.routing.subtype)}`);
  }
  const generationPlan = plan.generationPlan as unknown as Dict;
  if (expected.plan_version !== undefined) {
    expect(generationPlan.plan_version === expected.plan_version, `expected plan version ${String(expected.plan_version)}, got ${String(generationPlan.plan_version)}`);
  }
  if (expected.risk !== undefined) {
    expect(plan.risk.classification === expected.risk, `expected final risk ${String(expected.risk)}, got ${plan.risk.classification}`);
  }
  if (expected.review_required !== undefined) {
    expect(plan.risk.review_required === expected.review_required, `expected review_required=${String(expected.review_required)}, got ${String(plan.risk.review_required)}`);
  }

  const target = delegatedTargetFromPlan(plan);
  if (expected.no_target === true) {
    expect(target === null, 'direct or generic fixture unexpectedly created a delegated target');
    return;
  }
  if (expected.target_domain === undefined && expected.target_subtype === undefined) return;
  expect(target, 'delegated fixture did not create a DelegatedTargetPlan');
  const targetRouting = record(target.routing);
  const targetRisk = record(target.risk);
  if (expected.target_domain !== undefined) {
    expect(targetRouting.domain === expected.target_domain, `expected target Domain ${String(expected.target_domain)}, got ${String(targetRouting.domain)}`);
  }
  if (expected.target_subtype !== undefined) {
    expect(target.subtype === expected.target_subtype, `expected target Subtype ${String(expected.target_subtype)}, got ${String(target.subtype)}`);
  }
  if (expected.target_risk !== undefined) {
    expect(targetRisk.classification === expected.target_risk, `expected target risk ${String(expected.target_risk)}, got ${String(targetRisk.classification)}`);
  }
  if (expected.risk_at_least_target === true) {
    expect(
      riskRank(plan.risk.classification) >= riskRank(targetRisk.classification),
      `final risk ${plan.risk.classification} is lower than target risk ${String(targetRisk.classification)}`,
    );
  }
  for (const forbidden of ['artifact', 'authority_state', 'publication', 'review_receipt', 'review_state']) {
    expect(!Object.prototype.hasOwnProperty.call(target, forbidden), `DelegatedTargetPlan contains forbidden field ${forbidden}`);
  }
}

function assertArtifact(fixture: Dict): void {
  const expected = record(fixture.expected);
  const envelope = createValidatedIntakeEnvelope(rawIntake(fixture), 'api_request', config);
  const plan = compileRuntimePlan(envelope, config);
  assertPlan(fixture, plan);
  const generated = generateArtifact(envelope, 'ci', config);
  generatedPaths.push(generated.outputPath);
  const artifactEnvelope = generated.artifact as unknown as Dict;
  const payload = record(artifactEnvelope.artifact);
  const identity = record(payload.canonical_prompt_identity);
  const authorization = record(artifactEnvelope.authorization);

  if (expected.artifact_schema !== undefined) {
    expect(artifactEnvelope.schema_version === expected.artifact_schema, `expected artifact schema ${String(expected.artifact_schema)}, got ${String(artifactEnvelope.schema_version)}`);
  }
  if (expected.template_suffix !== undefined) {
    expect(
      normalizePath(identity.templatePath).endsWith(String(expected.template_suffix)),
      `expected template suffix ${String(expected.template_suffix)}, got ${String(identity.templatePath)}`,
    );
  }
  if (expected.authority_state !== undefined) {
    expect(authorization.authority_state === expected.authority_state, `expected authority state ${String(expected.authority_state)}, got ${String(authorization.authority_state)}`);
  }
  const verification = verifyRuntimeArtifact(generated.outputPath, config);
  expect(
    verification.verification_status === expected.verification_status,
    `expected verification ${String(expected.verification_status)}, got ${verification.verification_status}: ${verification.diagnostics.join('; ')}`,
  );
}

function assertCompileError(fixture: Dict): void {
  const expected = record(fixture.expected);
  let message = '';
  try {
    compileFixture(fixture);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message.length > 0, 'expected canonical planning to fail');
  expect(message.includes(String(expected.error_contains)), `expected error containing ${String(expected.error_contains)}, got ${message}`);
}

function assertTemplateMutation(fixture: Dict): void {
  const expected = record(fixture.expected);
  const generated = generateArtifact(
    createValidatedIntakeEnvelope(rawIntake(fixture), 'api_request', config),
    'ci',
    config,
  );
  generatedPaths.push(generated.outputPath);
  const tampered = record(yaml.load(readFileSync(generated.outputPath, 'utf8')));
  const payload = record(tampered.artifact);
  const provenance = record(payload.delegation_provenance);
  const target = record(provenance.target);
  const template = record(target.template);
  expect(String(template.path).length > 0, 'delegated artifact target template provenance is missing');
  template.path = join(config.domains_path, 'repo_review', 'templates', 'mutated-template.j2');
  tampered.artifact_sha256 = sha256Json(payload);
  const { envelope_sha256: _oldEnvelopeDigest, ...withoutEnvelopeDigest } = tampered;
  tampered.envelope_sha256 = sha256Json(withoutEnvelopeDigest);
  const tamperedPath = join(temporaryRoot, 'tampered-historical-demand-artifact.yaml');
  writeFileSync(tamperedPath, yaml.dump(tampered, { lineWidth: 120, noRefs: true }));
  const verification = verifyRuntimeArtifact(tamperedPath, config);
  expect(
    verification.verification_status === expected.verification_status,
    `expected mutated artifact verification ${String(expected.verification_status)}, got ${verification.verification_status}`,
  );
  rmSync(tamperedPath, { force: true });
}

for (const fixture of cases) {
  const id = String(fixture.id);
  test(id, () => {
    const operation = String(fixture.operation);
    if (operation === 'artifact') return assertArtifact(fixture);
    if (operation === 'compile_error') return assertCompileError(fixture);
    if (operation === 'template_mutation') return assertTemplateMutation(fixture);
    throw new Error(`Unsupported historical-demand fixture operation: ${operation}`);
  });
}

for (const path of generatedPaths) rmSync(path, { force: true });
rmSync(temporaryRoot, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`Historical-demand regression tests failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Historical-demand regression tests passed: ${passed}.`);
