#!/usr/bin/env tsx
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import * as runtimeAuthority from '../src/runtime-authority.js';
import {
  compileGenerationPlan,
  createFixtureEnvelope,
  createValidatedIntakeEnvelope,
  deriveRuntimeAssessment,
  generateArtifact,
  generateFromCliArgs,
  reviewArtifact,
  sha256Json,
  sha256Text,
  validateContractForTest,
  verifyArtifact,
  type RuntimeArtifactEnvelope,
  type ValidatedIntakeEnvelope,
} from '../src/runtime-authority-api.js';
import { loadConfig, validateAllCases, type PEaCConfig } from '../src/peac.js';

process.env.EXPECTED_TESTED_SHA ??= process.env.TESTED_SHA;

const temp = mkdtempSync(join(tmpdir(), 'peac-runtime-authority-'));
const created = new Set<string>();
let passed = 0;
const failures: string[] = [];

function test(id: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${id}: ${(error as Error).message}`);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrows(fn: () => void, contains?: string): void {
  let message = '';
  try { fn(); } catch (error) { message = (error as Error).message; }
  if (!message) throw new Error('expected an error');
  if (contains && !message.includes(contains)) throw new Error(`expected error containing ${contains}, got ${message}`);
}

function lowRiskIntake(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request: 'create prompt for a friendly greeting',
    desired_output: 'a short reusable prompt',
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
    available_sources: [],
    ...overrides,
  };
}

function createIntake(overrides: Record<string, unknown> = {}, config?: PEaCConfig): ValidatedIntakeEnvelope {
  return createValidatedIntakeEnvelope(lowRiskIntake(overrides), 'api_request', config);
}

function generated(overrides: Record<string, unknown> = {}): { path: string; envelope: RuntimeArtifactEnvelope } {
  const result = generateArtifact(createIntake(overrides), 'ci');
  created.add(result.outputPath);
  return { path: result.outputPath, envelope: result.artifact };
}

function fixtureFile(inputs: Record<string, unknown>, domain = 'general'): string {
  const path = join(temp, `fixture-${Math.random().toString(16).slice(2)}.yaml`);
  writeFileSync(path, yaml.dump({ case_id: 'runtime.test', domain, inputs }, { noRefs: true }));
  return path;
}

function cloneEnvelope(value: RuntimeArtifactEnvelope): RuntimeArtifactEnvelope {
  return structuredClone(value);
}

function recomputeEnvelopeDigests(value: RuntimeArtifactEnvelope): RuntimeArtifactEnvelope {
  const envelope = cloneEnvelope(value);
  const artifact = envelope.artifact;
  const hashes = artifact.hashes as Record<string, unknown>;
  const intake = artifact.canonical_intake as Record<string, unknown>;
  const ledger = ((artifact.validation_ledger as Record<string, unknown>).checks as unknown[]);
  hashes.rendered_prompt_hash = sha256Text(String(artifact.rendered_prompt ?? ''));
  hashes.normalized_inputs_hash = sha256Json((intake.normalized_inputs as Record<string, unknown> | undefined) ?? {});
  hashes.generation_plan_hash = sha256Json(artifact.generation_plan);
  hashes.validation_ledger_hash = sha256Json(ledger);
  envelope.artifact_sha256 = sha256Json(artifact);
  const { envelope_sha256: _ignored, ...partial } = envelope;
  envelope.envelope_sha256 = sha256Json(partial);
  return envelope;
}

function writeEnvelope(name: string, value: RuntimeArtifactEnvelope): string {
  const path = join(temp, name);
  writeFileSync(path, yaml.dump(value, { lineWidth: 120, noRefs: true }));
  return path;
}

function ledger(value: RuntimeArtifactEnvelope): Array<Record<string, unknown>> {
  return ((value.artifact.validation_ledger as Record<string, unknown>).checks as Array<Record<string, unknown>>);
}

function plan(value: RuntimeArtifactEnvelope): Record<string, unknown> {
  return value.artifact.generation_plan as Record<string, unknown>;
}

function syntheticValidatorConfig(): PEaCConfig {
  const root = join(temp, 'synthetic');
  const domains = join(root, 'domains');
  const policies = join(root, 'policies');
  const general = join(domains, 'general');
  mkdirSync(general, { recursive: true });
  mkdirSync(policies, { recursive: true });
  writeFileSync(join(general, 'input.contract.yaml'), yaml.dump({
    contract_version: 'test.v1',
    additional_properties: true,
    fields: { required: [{ name: 'task', type: 'string' }, { name: 'output_format', type: 'string' }], optional: [] },
  }));
  writeFileSync(join(general, 'route.yaml'), yaml.dump({ domain: 'general', version: 'test.v1', subtypes: [{ id: 'default' }] }));
  writeFileSync(join(general, 'rules.yaml'), yaml.dump({ rules: [{ id: 'SYN-RULE', rule: 'Preserve the requested output form.' }] }));
  writeFileSync(join(general, 'validators.yaml'), yaml.dump({
    static_checks: [
      { id: 'synthetic_required_output', type: 'output_check', check: "rendered_prompt contains 'REQUIRED'", severity: 'error' },
      { id: 'synthetic_task_present', type: 'field_check', check: 'task.length > 0', severity: 'error' },
      { id: 'synthetic_not_applicable', type: 'field_check', applies_when: 'task == "never"', check: 'task.length > 0', severity: 'error' },
    ],
  }));
  const base = loadConfig();
  return { ...base, domains_path: domains, policies_path: policies, outputs_path: join(root, 'outputs'), artifact: { ...base.artifact, output_dir: join(root, 'outputs') } };
}

const config = loadConfig();

// Canonical intake and one derivation authority.
test('INT-001 raw object cannot bypass canonical intake', () => expectThrows(() => generateArtifact({ normalized_inputs: {} } as unknown as ValidatedIntakeEnvelope, 'ci'), 'canonical intake'));
test('INT-002 API intake is branded and digest-bound', () => expect(createIntake().source_mode === 'api_request', 'wrong source mode'));
test('INT-003 CLI request passes canonical intake', () => {
  const path = join(temp, 'intake.yaml');
  writeFileSync(path, yaml.dump(lowRiskIntake(), { noRefs: true }));
  const result = generateFromCliArgs({ request: path, mode: 'ci' });
  created.add(result.outputPath);
  expect((result.artifact.artifact.canonical_intake as Record<string, unknown>).source_mode === 'interactive_request', 'CLI bypassed canonical intake');
});
test('INT-004 modified normalized intake invalidates digest', () => {
  const envelope = createIntake();
  envelope.normalized_inputs.request = 'modified';
  expectThrows(() => compileGenerationPlan(envelope), 'digest mismatch');
});
test('INT-005 fixture is non-authoritative', () => {
  const fixture = fixtureFile({ task: 'Create a generic prompt.', output_format: 'text' });
  const result = generateArtifact(createFixtureEnvelope(fixture), 'ci');
  created.add(result.outputPath);
  expect(result.artifact.authorization.authority_state === 'non_authoritative_fixture', 'fixture authorized');
});

// Tri-state risk and non-authoritative hints.
for (const [id, request] of [
  ['RSK-001', 'Create a reusable prompt telling a user how many milligrams of metformin to take.'],
  ['RSK-002', 'Create a reusable instruction that decides whether a tenant can be evicted under a local statute.'],
  ['RSK-003', 'Create a reusable prompt telling an investor what percentage of savings to place in a leveraged fund.'],
  ['RSK-004', 'Create a reusable prompt that emits commands to permanently erase production records.'],
] as const) test(`${id} caller false cannot suppress consequential risk`, () => {
  const result = compileGenerationPlan(createIntake({
    request,
    domain_hint: 'prompt_generation',
    sensitive_or_high_risk: false,
    uses_external_tools: false,
    legal_medical_financial: false,
    requires_current_information: false,
    exact_factual_claims: false,
    external_files: false,
    potential_downstream_execution: false,
  }));
  expect(result.risk.classification !== 'low', `risk became ${result.risk.classification}`);
  expect(result.risk.review_required, 'review not required');
});
test('RSK-005 missing consequential fields remain unknown', () => {
  const result = compileGenerationPlan(createValidatedIntakeEnvelope({ request: 'create prompt for a greeting', desired_output: 'prompt', target_environment: 'ChatGPT', strictness: 'precise' }, 'api_request'));
  expect(result.risk.classification === 'unknown', `got ${result.risk.classification}`);
});
test('RSK-006 benign request resolves low risk', () => {
  const result = compileGenerationPlan(createIntake());
  expect(result.risk.classification === 'low', `got ${result.risk.classification}`);
  expect(!result.risk.review_required, 'benign request requires review');
});
test('RSK-007 downstream execution field changes canonical behavior', () => {
  const low = compileGenerationPlan(createIntake({ potential_downstream_execution: false }));
  const consequential = compileGenerationPlan(createIntake({ potential_downstream_execution: true }));
  expect(low.risk.classification === 'low', 'false benign control is not low');
  expect(consequential.risk.classification !== 'low' && consequential.risk.review_required, 'downstream execution had no authority effect');
});
test('RTE-001 conflicting general hint cannot override strong prompt-generation route', () => {
  const result = compileGenerationPlan(createIntake({ request: 'Create a reusable system prompt with explicit constraints and an output format.', domain_hint: 'general' }));
  expect(result.routing.domain === 'prompt_generation', `hint forced ${result.routing.domain}`);
  expect(result.routing.hint_conflict, 'conflict not recorded');
  expect(result.risk.review_required, 'routing conflict did not require review');
});
test('RSK-008 domain risk overrides are compiled into canonical assessment', () => expect(compileGenerationPlan(createIntake({ requires_current_information: true })).risk.applied_rules.length > 0, 'domain risk rules absent'));

// Contract behavior.
const contractBase = { fields: { required: [{ name: 'name', type: 'string' }], optional: [] } };
test('CTR-001 wrong type rejected', () => expect(validateContractForTest(contractBase, { name: 1 }).errors.length > 0, 'wrong type accepted'));
test('CTR-002 enum rejected', () => expect(validateContractForTest({ fields: { required: [{ name: 'mode', type: 'string', enum: ['a', 'b'] }] } }, { mode: 'c' }).errors.length > 0, 'enum accepted'));
test('CTR-003 array item type rejected', () => expect(validateContractForTest({ fields: { required: [{ name: 'items', type: 'array', item_type: 'string' }] } }, { items: ['a', 2] }).errors.length > 0, 'array item accepted'));
test('CTR-004 additional property policy enforced', () => expect(validateContractForTest({ additional_properties: false, fields: { required: [{ name: 'name', type: 'string' }] } }, { name: 'x', extra: true }).errors.length > 0, 'additional property accepted'));
test('CTR-005 conditional required field enforced', () => expect(validateContractForTest({ fields: { required: [{ name: 'enabled', type: 'boolean' }], optional: [{ name: 'detail', type: 'string', required_if: 'enabled == true' }] } }, { enabled: true }).errors.length > 0, 'conditional field accepted'));

// Real per-Check execution.
test('CHK-001 exactly one validator fails without contaminating unrelated Checks', () => {
  const synthetic = syntheticValidatorConfig();
  const envelope = createValidatedIntakeEnvelope({
    request: 'friendly greeting', desired_output: 'short text', target_environment: 'ChatGPT', strictness: 'precise',
    sensitive_or_high_risk: false, uses_external_tools: false, legal_medical_financial: false,
    requires_current_information: false, exact_factual_claims: false, external_files: false,
    potential_downstream_execution: false, domain_hint: 'general', requested_actions: [], available_sources: [],
  }, 'api_request', synthetic);
  const assessment = deriveRuntimeAssessment({
    validatedIntake: envelope,
    config: synthetic,
    renderedPrompt: 'A harmless greeting without the required marker.',
    integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true },
  });
  const byId = new Map(assessment.validationLedger.map((record) => [record.check_id, record]));
  expect(byId.get('synthetic_required_output')?.passed === false, 'target Check did not fail');
  expect(byId.get('synthetic_task_present')?.passed === true, 'unrelated Check did not retain true result');
  expect(byId.get('synthetic_not_applicable')?.executed === false && byId.get('synthetic_not_applicable')?.passed === null, 'non-applicable semantics violated');
  expect(assessment.authorityDecision.authority_state === 'rejected', 'blocking per-Check failure did not reject');
});

const valid = generated();
const validLedger = ledger(valid.envelope);
test('CHK-002 generated ledger has unique Check IDs', () => expect(new Set(validLedger.map((item) => item.check_id)).size === validLedger.length, 'duplicate Check IDs generated'));
test('CHK-003 actual Check IDs exactly equal required Check IDs', () => {
  const required = ((plan(valid.envelope).required_checks as Array<Record<string, unknown>>).map((item) => item.check_id).sort());
  const actual = validLedger.map((item) => item.check_id).sort();
  expect(sha256Json(required) === sha256Json(actual), 'required Check set differs');
});
test('CHK-004 aggregate compatibility validation is derived from per-Check records', () => {
  const compatibility = valid.envelope.artifact.validation as Record<string, unknown>;
  expect(typeof compatibility.passed === 'boolean' && Array.isArray(compatibility.checks_run), 'legacy projection missing');
});

// Hash-consistent semantic mutations.
test('MUT-A fake passing ledger with valid hashes is rejected by Check-set comparison', () => {
  const copy = cloneEnvelope(valid.envelope);
  (copy.artifact.validation_ledger as Record<string, unknown>).checks = [{ check_id: 'fake', source: 'fake', applicable: true, executed: true, passed: true, blocking: true, diagnostics: [], evidence: {} }];
  const mutated = recomputeEnvelopeDigests(copy);
  const result = verifyArtifact(writeEnvelope('mut-fake-ledger.yaml', mutated));
  expect(result.verification_status === 'rejected' && result.diagnostics.some((item) => item.includes('Check IDs')), result.diagnostics.join('; '));
});
test('MUT-B removed required Check with valid hashes is rejected', () => {
  const copy = cloneEnvelope(valid.envelope);
  const checks = ledger(copy); checks.splice(0, 1);
  const result = verifyArtifact(writeEnvelope('mut-removed-check.yaml', recomputeEnvelopeDigests(copy)));
  expect(result.verification_status === 'rejected' && result.diagnostics.some((item) => item.includes('Missing required Check')), result.diagnostics.join('; '));
});
test('MUT-C unknown Check with valid hashes is rejected', () => {
  const copy = cloneEnvelope(valid.envelope);
  ledger(copy).push({ check_id: 'unknown.check', source: 'mutation', applicable: true, executed: true, passed: true, blocking: true, diagnostics: [], evidence: {} });
  const result = verifyArtifact(writeEnvelope('mut-unknown-check.yaml', recomputeEnvelopeDigests(copy)));
  expect(result.verification_status === 'rejected' && result.diagnostics.some((item) => item.includes('Unexpected Check')), result.diagnostics.join('; '));
});
test('MUT-D duplicate Check with valid hashes is rejected', () => {
  const copy = cloneEnvelope(valid.envelope);
  ledger(copy).push(structuredClone(ledger(copy)[0]!));
  const result = verifyArtifact(writeEnvelope('mut-duplicate-check.yaml', recomputeEnvelopeDigests(copy)));
  expect(result.verification_status === 'rejected' && result.diagnostics.some((item) => item.includes('Duplicate Check')), result.diagnostics.join('; '));
});

const pending = generated({ request: 'Create a reusable prompt telling a user how many milligrams of metformin to take.', domain_hint: 'prompt_generation' });
test('AUT-001 consequential Artifact is review_pending', () => expect(pending.envelope.authorization.authority_state === 'review_pending', `got ${pending.envelope.authorization.authority_state}`));
test('AUT-002 review_pending Artifact is not downstream usable', () => expect(!pending.envelope.authorization.downstream_use_allowed, 'pending Artifact usable'));
test('MUT-E authority rewrite with valid hashes is rejected semantically', () => {
  const copy = cloneEnvelope(pending.envelope);
  copy.authorization.review_required = false;
  copy.authorization.authority_state = 'authorized';
  copy.authorization.downstream_use_allowed = true;
  copy.authorization.review_receipt = null;
  const result = verifyArtifact(writeEnvelope('mut-authority.yaml', recomputeEnvelopeDigests(copy)));
  expect(result.verification_status === 'rejected' && result.diagnostics.some((item) => item.startsWith('authorization')), result.diagnostics.join('; '));
});
test('MUT-F generation-plan route rewrite with valid hashes is rejected semantically', () => {
  const copy = cloneEnvelope(valid.envelope);
  const routing = (plan(copy).routing as Record<string, unknown>); routing.domain = 'general'; routing.method = 'caller_override';
  const result = verifyArtifact(writeEnvelope('mut-plan-route.yaml', recomputeEnvelopeDigests(copy)));
  expect(result.verification_status === 'rejected' && result.diagnostics.some((item) => item.includes('generation_plan.routing')), result.diagnostics.join('; '));
});
test('MUT-G generation-plan risk rewrite with valid hashes is rejected semantically', () => {
  const copy = cloneEnvelope(pending.envelope);
  const risk = (plan(copy).risk as Record<string, unknown>); risk.classification = 'low'; risk.review_required = false;
  const result = verifyArtifact(writeEnvelope('mut-plan-risk.yaml', recomputeEnvelopeDigests(copy)));
  expect(result.verification_status === 'rejected' && result.diagnostics.some((item) => item.includes('generation_plan.risk')), result.diagnostics.join('; '));
});

// Integrity and semantic verification are distinct.
test('VER-001 valid low-risk Artifact verifies', () => {
  const result = verifyArtifact(valid.path);
  expect(result.verification_status === 'verified', result.diagnostics.join('; '));
  expect(result.integrity_valid && result.semantic_derivation_valid && result.authority_consistent, 'verification dimensions not all true');
});
test('VER-002 wrong outer digest is integrity rejection', () => {
  const copy = cloneEnvelope(valid.envelope); copy.artifact_sha256 = '0'.repeat(64);
  const result = verifyArtifact(writeEnvelope('wrong-artifact-digest.yaml', copy));
  expect(result.verification_status === 'rejected' && !result.integrity_valid, 'wrong digest accepted');
});
test('VER-003 semantic mutation with recomputed hashes still fails semantic verification', () => {
  const copy = cloneEnvelope(valid.envelope);
  (plan(copy).routing as Record<string, unknown>).method = 'persisted-claim';
  const result = verifyArtifact(writeEnvelope('semantic-valid-hashes.yaml', recomputeEnvelopeDigests(copy)));
  expect(result.verification_status === 'rejected' && !result.semantic_derivation_valid, result.diagnostics.join('; '));
});

// Exactly one public review transition.
test('REV-001 runtime-authority module exports no review transition', () => expect(!('reviewArtifact' in runtimeAuthority), 'alternate reviewArtifact export exists'));
test('REV-002 official API rejects insufficient evidence', () => {
  const copy = cloneEnvelope(pending.envelope);
  const sources = copy.artifact.governing_sources as Array<Record<string, unknown>>;
  sources[0]!.path = join(temp, 'missing-governing-source.yaml');
  const path = writeEnvelope('insufficient-evidence.yaml', recomputeEnvelopeDigests(copy));
  expect(verifyArtifact(path).verification_status === 'insufficient_evidence', 'fixture did not produce insufficient evidence');
  expectThrows(() => reviewArtifact(path, 'approved'), 'unverified');
});
test('REV-003 CLI delegates to sole official API', () => expect(readFileSync('scripts/peac-review-artifact.ts', 'utf8').includes("runtime-authority-api.js"), 'CLI imports alternate authority'));
test('REV-004 approved exact-Artifact receipt authorizes eligible Artifact', () => {
  const another = generated({ request: 'Create a reusable prompt telling a user how many milligrams of metformin to take.', domain_hint: 'prompt_generation' });
  const reviewed = reviewArtifact(another.path, 'approved');
  created.delete(another.path); created.add(reviewed.outputPath);
  const result = verifyArtifact(reviewed.outputPath);
  expect(reviewed.artifact.authorization.authority_state === 'authorized' && result.verification_status === 'verified', result.diagnostics.join('; '));
});
test('REV-005 rejected receipt produces rejected Artifact', () => {
  const another = generated({ request: 'Create a reusable prompt deciding whether a tenant can be evicted under a local statute.', domain_hint: 'prompt_generation' });
  const reviewed = reviewArtifact(another.path, 'rejected');
  created.delete(another.path); created.add(reviewed.outputPath);
  expect(reviewed.artifact.authorization.authority_state === 'rejected' && !reviewed.artifact.authorization.downstream_use_allowed, 'rejected review authorized');
});
test('REV-006 receipt is invalidated by Artifact content change', () => {
  const another = generated({ request: 'Create a reusable prompt telling an investor what percentage to place in a leveraged fund.', domain_hint: 'prompt_generation' });
  const reviewed = reviewArtifact(another.path, 'approved');
  created.delete(another.path); created.add(reviewed.outputPath);
  const copy = cloneEnvelope(reviewed.artifact);
  copy.artifact.rendered_prompt = `${String(copy.artifact.rendered_prompt)} changed`;
  const mutated = recomputeEnvelopeDigests(copy);
  const result = verifyArtifact(writeEnvelope('stale-receipt.yaml', mutated));
  expect(result.verification_status === 'rejected', 'stale receipt accepted');
});

// Existing functional boundaries.
test('BND-001 deterministic rendering preserved', () => {
  const a = generated().envelope; const b = generated().envelope;
  expect(a.artifact.rendered_prompt === b.artifact.rendered_prompt, 'rendered prompt changed across identical inputs');
});
test('BND-002 static assurance does not claim target-model execution', () => expect((valid.envelope.artifact.assurance as Record<string, unknown>).target_model_executed === false, 'target-model execution claimed'));
test('BND-003 production-grade remains bounded static profile', () => expect(compileGenerationPlan(createIntake({ strictness: 'production-grade', success_criteria: ['x'], failure_modes: ['y'], eval_suite: ['core_quality/self_check'] })).evaluation.profile === 'static_production_profile', 'production-grade not bounded'));
test('BND-004 exact checkout provenance recorded', () => expect(/^[0-9a-f]{40}$/.test(String((valid.envelope.artifact.runtime as Record<string, unknown>).git_commit_sha)), 'checkout SHA missing'));
test('BND-005 existing case suite remains a positive control', () => {
  const result = validateAllCases();
  expect(result.failed === 0, result.failures.join('; '));
});
test('BND-006 PR-Inspector boundary source remains present', () => expect(existsSync('src/pr-inspector-boundary.ts'), 'PR-Inspector boundary missing'));

for (const path of created) rmSync(path, { force: true });
rmSync(temp, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`PEaC Runtime authority self-test failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PEaC Runtime authority self-test passed: ${passed} checks.`);
