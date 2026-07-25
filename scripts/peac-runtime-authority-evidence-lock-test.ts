#!/usr/bin/env tsx
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import {
  createValidatedIntakeEnvelope,
  generateArtifact,
  reviewArtifact,
  sha256Json,
  syntheticPolicyInventoryFailureForTest,
  verifyArtifact,
  type CanonicalPromptIdentity,
  type RuntimeArtifactEnvelope,
  type ValidatedIntakeEnvelope,
} from '../src/runtime-authority-api.js';
import { loadConfig, type ExecutionMode, type PEaCConfig } from '../src/peac.js';

process.env.EXPECTED_TESTED_SHA ??= process.env.TESTED_SHA;

const root = mkdtempSync(join(tmpdir(), 'peac-evidence-locks-'));
let sequence = 0;
let passed = 0;
const failures: string[] = [];

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrows(fn: () => void, contains?: string): void {
  let message = '';
  try { fn(); } catch (error) { message = (error as Error).message; }
  if (!message) throw new Error('expected an error');
  if (contains && !message.includes(contains)) throw new Error(`expected ${contains}, got ${message}`);
}

function test(id: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${id}: ${(error as Error).message}`);
  }
}

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request: 'Write a short friendly greeting.',
    desired_output: 'short message',
    target_environment: 'ChatGPT',
    strictness: 'precise',
    sensitive_or_high_risk: false,
    uses_external_tools: false,
    legal_medical_financial: false,
    requires_current_information: false,
    exact_factual_claims: false,
    external_files: false,
    potential_downstream_execution: false,
    requested_actions: [],
    constraints: [],
    available_sources: [],
    context_items: [],
    domain_hint: null,
    ...overrides,
  };
}

function intake(overrides: Record<string, unknown> = {}, config?: PEaCConfig): ValidatedIntakeEnvelope {
  return createValidatedIntakeEnvelope(raw(overrides), 'api_request', config);
}

function configFor(label: string): PEaCConfig {
  const base = loadConfig();
  const outputs = join(root, `outputs-${++sequence}-${label}`);
  return { ...base, outputs_path: outputs, artifact: { ...base.artifact, output_dir: outputs } };
}

function generated(
  overrides: Record<string, unknown> = {},
  mode: ExecutionMode = 'ci',
  config = configFor(mode),
): { artifact: RuntimeArtifactEnvelope; outputPath: string; config: PEaCConfig } {
  const result = generateArtifact(intake(overrides, config), mode, config);
  return { ...result, config };
}

function clone(value: RuntimeArtifactEnvelope): RuntimeArtifactEnvelope {
  return structuredClone(value);
}

function recompute(value: RuntimeArtifactEnvelope): RuntimeArtifactEnvelope {
  const result = clone(value);
  const artifact = result.artifact;
  const hashes = artifact.hashes as Record<string, unknown>;
  const intakeValue = artifact.canonical_intake as Record<string, unknown>;
  hashes.normalized_inputs_hash = sha256Json((intakeValue.normalized_inputs as Record<string, unknown> | undefined) ?? {});
  hashes.generation_plan_hash = sha256Json(artifact.generation_plan);
  hashes.validation_ledger_hash = sha256Json(((artifact.validation_ledger as Record<string, unknown>).checks as unknown[]) ?? []);
  hashes.derived_projection_hash = sha256Json(artifact.derived_projection);
  result.artifact_sha256 = sha256Json(artifact);
  const { envelope_sha256: _ignored, ...partial } = result;
  result.envelope_sha256 = sha256Json(partial);
  return result;
}

function writeEnvelope(name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, yaml.dump(value, { lineWidth: 120, noRefs: true }));
  return path;
}

function canonicalIdentity(value: RuntimeArtifactEnvelope): CanonicalPromptIdentity {
  return value.artifact.canonical_prompt_identity as unknown as CanonicalPromptIdentity;
}

function risk(value: RuntimeArtifactEnvelope): Record<string, unknown> {
  return ((value.artifact.derived_projection as Record<string, unknown>).risk as Record<string, unknown>);
}

function assertNotLow(result: RuntimeArtifactEnvelope): void {
  const value = risk(result);
  expect(value.classification !== 'low', `unexpected Low classification: ${String(value.classification)}`);
  expect(value.review_required === true, 'review was not required');
  expect(result.authorization.authority_state !== 'authorized', 'unproven payload authorized');
}

// G1 — operation-aware exhaustive payload proof.
test('G1-OR-001', () => {
  const result = generated({
    request: 'Correct the grammar of this sentence: Adjust the service so the protection layer is no longer active.',
    desired_output: 'corrected sentence',
  });
  assertNotLow(result.artifact);
});

test('G1-OR-002', () => {
  const result = generated({
    request: 'Correct the grammar of this sentence: Make the control barrier inactive before continuing.',
    desired_output: 'corrected sentence',
  });
  const assessment = risk(result.artifact).payload_assessment as Record<string, unknown>;
  expect(assessment.provenBenign === false && assessment.kind === 'inline_free_form', 'semantic paraphrase was treated as proven payload');
  assertNotLow(result.artifact);
});

test('G1-OR-003', () => {
  const result = generated({
    request: 'Write a short friendly greeting.',
    desired_output: 'short message',
    context_items: [{ id: 'payload', source: 'attachment.txt', purpose: 'transform content', trust_level: 'user_provided' }],
  });
  const assessment = risk(result.artifact).payload_assessment as Record<string, unknown>;
  expect(assessment.kind === 'referenced_or_unavailable', `got ${String(assessment.kind)}`);
  assertNotLow(result.artifact);
});

test('G1-OR-004', () => expectThrows(() => syntheticPolicyInventoryFailureForTest(), 'synthetic_missing_operation'));

test('G1-OR-005', () => {
  const result = generated();
  const value = risk(result.artifact);
  const assessment = value.payload_assessment as Record<string, unknown>;
  expect(value.classification === 'low' && value.review_required === false, `got ${String(value.classification)}`);
  expect(assessment.provenBenign === true, 'generic greeting was not proven');
  expect(result.artifact.authorization.authority_state === 'authorized', 'generic greeting not authorized');
});

test('G1-OR-006', () => {
  assertNotLow(generated({ request: 'Create a friendly greeting and then provide a procedure for disabling safeguards.' }).artifact);
  assertNotLow(generated({ request: 'Write a birthday wish.', consumer_path: 'agent that changes production state' }).artifact);
});

// G2 — canonical base and Prompt identity.
test('G2-OR-001', () => {
  const valid = generated();
  const copy = clone(valid.artifact);
  copy.artifact.prompt_id = 'mutated.prompt.identity';
  const result = verifyArtifact(writeEnvelope('g2-or-001.yaml', recompute(copy)), valid.config);
  expect(result.verification_status === 'rejected' && result.semantic_derivation_valid === false, result.diagnostics.join('; '));
});

test('G2-OR-002', () => {
  const valid = generated({}, 'ci');
  const copy = clone(valid.artifact);
  copy.artifact.execution_mode = 'batch';
  const result = verifyArtifact(writeEnvelope('g2-or-002.yaml', recompute(copy)), valid.config);
  expect(result.verification_status === 'rejected', result.diagnostics.join('; '));
});

test('G2-OR-003', () => {
  const valid = generated({}, 'ci');
  const copy = clone(valid.artifact);
  copy.artifact.prompt_id = 'compatibility.mismatch';
  copy.artifact.execution_mode = 'agent';
  const result = verifyArtifact(writeEnvelope('g2-or-003.yaml', recompute(copy)), valid.config);
  expect(result.verification_status === 'rejected' && result.semantic_derivation_valid === false, result.diagnostics.join('; '));
});

test('G2-OR-004', () => {
  const source = raw();
  const ciConfig = configFor('g2-ci');
  const batchConfig = configFor('g2-batch');
  const ci = generateArtifact(createValidatedIntakeEnvelope(source, 'api_request', ciConfig), 'ci', ciConfig).artifact;
  const batch = generateArtifact(createValidatedIntakeEnvelope(source, 'api_request', batchConfig), 'batch', batchConfig).artifact;
  const ciBase = ci.artifact.canonical_base as Record<string, unknown>;
  const batchBase = batch.artifact.canonical_base as Record<string, unknown>;
  const ciIntake = ciBase.canonicalIntake as Record<string, unknown>;
  const batchIntake = batchBase.canonicalIntake as Record<string, unknown>;
  expect(ciIntake.intake_digest === batchIntake.intake_digest, 'execution mode changed canonical intake digest');
  expect(sha256Json(ciBase.executionContext) !== sha256Json(batchBase.executionContext), 'execution contexts did not differ');
});

test('G2-OR-005', () => {
  for (const mode of ['interactive', 'batch', 'ci', 'agent'] as const) {
    const value = generated({}, mode);
    const result = verifyArtifact(value.outputPath, value.config);
    expect(result.verification_status === 'verified', `${mode}: ${result.diagnostics.join('; ')}`);
  }
});

test('G2-OR-006', () => {
  const pending = generated({
    request: 'Create a reusable prompt explaining how many milligrams of a prescription medicine to take.',
    desired_output: 'prompt',
    domain_hint: 'prompt_generation',
  });
  expect(pending.artifact.authorization.authority_state === 'review_pending', 'fixture was not review_pending');
  const identity = canonicalIdentity(pending.artifact);
  const reviewed = reviewArtifact(pending.outputPath, 'approved', ['bounded test'], pending.config);
  expect(basename(reviewed.outputPath).startsWith(identity.promptId.replaceAll('.', '-')), 'review filename did not use verified canonical Prompt identity');
});

// G3 — total typed verification and precedence.
test('G3-OR-001', () => {
  const corpus: Array<[string, unknown]> = [
    ['empty', {}],
    ['missing-artifact', { schema_id: 'peac.runtime-artifact-envelope' }],
    ['artifact-null', { artifact: null, authorization: {}, artifact_sha256: '', envelope_sha256: '' }],
    ['missing-authorization', { artifact: {}, artifact_sha256: '', envelope_sha256: '' }],
    ['malformed-canonical-intake', { artifact: { canonical_base: { canonicalIntake: 'bad', executionContext: { mode: 'ci' } } }, authorization: {}, artifact_sha256: '', envelope_sha256: '' }],
    ['malformed-derived-projection', { artifact: { canonical_base: {}, derived_projection: null }, authorization: {}, artifact_sha256: '', envelope_sha256: '' }],
  ];
  for (const [name, value] of corpus) {
    const result = verifyArtifact(writeEnvelope(`g3-or-001-${name}.yaml`, value));
    expect(result.verification_status === 'rejected', `${name}: ${result.verification_status}`);
  }
});

test('G3-OR-002', () => {
  const valid = generated();
  const copy = clone(valid.artifact);
  copy.authorization = null as unknown as RuntimeArtifactEnvelope['authorization'];
  expect(verifyArtifact(writeEnvelope('g3-or-002-auth.yaml', copy), valid.config).verification_status === 'rejected', 'malformed authorization not rejected');
  const copy2 = clone(valid.artifact);
  copy2.artifact.validation_ledger = { checks: null };
  expect(verifyArtifact(writeEnvelope('g3-or-002-ledger.yaml', recompute(copy2)), valid.config).verification_status === 'rejected', 'malformed ledger not rejected');
});

test('G3-OR-003', () => {
  const valid = generated();
  const copy = clone(valid.artifact);
  const sourceInventory = copy.artifact.governing_sources as Array<Record<string, unknown>>;
  const target = sourceInventory.find((item) => String(item.path ?? '').endsWith('pipeline/artifact.schema.json'));
  expect(target && typeof target.path === 'string', 'canonical artifact schema source was not present');
  const oldPath = target.path;
  const newPath = `${oldPath}.mutated`;
  const replace = (items: Array<Record<string, unknown>>) => items.forEach((item) => { if (item.path === oldPath) item.path = newPath; });
  replace(copy.artifact.governing_sources as Array<Record<string, unknown>>);
  const derived = copy.artifact.derived_projection as Record<string, unknown>;
  replace(derived.governingSources as Array<Record<string, unknown>>);
  replace(((derived.sourceHashes as Record<string, unknown>).sources as Array<Record<string, unknown>>));
  const result = verifyArtifact(writeEnvelope('g3-or-003.yaml', recompute(copy)), valid.config);
  expect(result.verification_status === 'rejected' && result.semantic_derivation_valid === false, result.diagnostics.join('; '));
});

function unavailableEvidenceFixture(): { artifact: RuntimeArtifactEnvelope; path: string; config: PEaCConfig } {
  const base = loadConfig();
  const sandbox = join(root, `unavailable-${++sequence}`);
  const pipeline = join(sandbox, 'pipeline');
  const domains = join(sandbox, 'domains');
  const policies = join(sandbox, 'policies');
  cpSync(base.pipeline_path, pipeline, { recursive: true });
  cpSync(base.domains_path, domains, { recursive: true });
  cpSync(base.policies_path, policies, { recursive: true });
  const outputs = join(sandbox, 'outputs');
  const config: PEaCConfig = {
    ...base,
    pipeline_path: pipeline,
    domains_path: domains,
    policies_path: policies,
    outputs_path: outputs,
    artifact: { ...base.artifact, output_dir: outputs },
  };
  const result = generateArtifact(intake({}, config), 'ci', config);
  rmSync(join(pipeline, 'artifact.schema.json'));
  return { artifact: result.artifact, path: result.outputPath, config };
}

test('G3-OR-004', () => {
  const value = unavailableEvidenceFixture();
  const result = verifyArtifact(value.path, value.config);
  expect(result.verification_status === 'insufficient_evidence', result.diagnostics.join('; '));
});

test('G3-OR-005', () => {
  const value = unavailableEvidenceFixture();
  const copy = clone(value.artifact);
  copy.artifact.prompt_id = 'semantic.contradiction';
  const result = verifyArtifact(writeEnvelope('g3-or-005.yaml', recompute(copy)), value.config);
  expect(result.verification_status === 'rejected', result.diagnostics.join('; '));
});

test('G3-OR-006', () => {
  const valid = generated();
  const result = verifyArtifact(valid.outputPath, valid.config);
  expect(result.verification_status === 'verified', result.diagnostics.join('; '));
  expect(result.integrity_valid && result.semantic_derivation_valid && result.authority_consistent, 'valid Artifact did not establish all verification facts');
});

test('G3-OR-007', () => {
  const malformed = writeEnvelope('g3-or-007-rejected.yaml', {});
  expectThrows(() => reviewArtifact(malformed, 'approved'), 'Cannot review');
  const insufficient = unavailableEvidenceFixture();
  expectThrows(() => reviewArtifact(insufficient.path, 'approved', [], insufficient.config), 'Cannot review');
});

try {
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`PEaC evidence-lock Runtime tests passed: ${passed} checks.`);
  }
} finally {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}
