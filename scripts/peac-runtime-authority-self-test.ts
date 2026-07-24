#!/usr/bin/env tsx
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import * as runtimeAuthority from '../src/runtime-authority.js';
import * as runtimeApi from '../src/runtime-authority-api.js';
import {
  compileGenerationPlan,
  compileRuntimePlan,
  createFixtureEnvelope,
  createValidatedIntakeEnvelope,
  generateArtifact,
  generateFromCliArgs,
  reviewArtifact,
  sha256Json,
  sha256Text,
  validateContractForTest,
  verifyArtifact,
  type CheckoutIdentity,
  type RequiredCheckDefinition,
  type RuntimeArtifactEnvelope,
  type RuntimePlanAssessment,
  type ValidatedIntakeEnvelope,
  type ValidationCheckRecord,
} from '../src/runtime-authority-api.js';
import {
  completeRuntimeAssessmentForTest,
  currentCheckoutIdentity,
  validateCompletionLedgerForTest,
} from '../src/runtime-authority-execution.js';
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
    request: 'Create a reusable prompt for a friendly greeting.',
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
    constraints: [],
    available_sources: [],
    ...overrides,
  };
}

function createIntake(overrides: Record<string, unknown> = {}, config?: PEaCConfig): ValidatedIntakeEnvelope {
  return createValidatedIntakeEnvelope(lowRiskIntake(overrides), 'api_request', config);
}

function generated(overrides: Record<string, unknown> = {}, config?: PEaCConfig): { path: string; envelope: RuntimeArtifactEnvelope } {
  const result = generateArtifact(createIntake(overrides, config), 'ci', config);
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

function derived(value: RuntimeArtifactEnvelope): Record<string, unknown> {
  return value.artifact.derived_projection as Record<string, unknown>;
}

function ledger(value: RuntimeArtifactEnvelope): ValidationCheckRecord[] {
  return ((value.artifact.validation_ledger as Record<string, unknown>).checks as ValidationCheckRecord[]);
}

function plan(value: RuntimeArtifactEnvelope): Record<string, unknown> {
  return value.artifact.generation_plan as Record<string, unknown>;
}

function recomputeEnvelopeDigests(value: RuntimeArtifactEnvelope): RuntimeArtifactEnvelope {
  const envelope = cloneEnvelope(value);
  const artifact = envelope.artifact;
  const hashes = artifact.hashes as Record<string, unknown>;
  const intake = artifact.canonical_intake as Record<string, unknown>;
  hashes.rendered_prompt_hash = sha256Text(String(artifact.rendered_prompt ?? ''));
  hashes.normalized_inputs_hash = sha256Json((intake.normalized_inputs as Record<string, unknown> | undefined) ?? {});
  hashes.generation_plan_hash = sha256Json(artifact.generation_plan);
  hashes.validation_ledger_hash = sha256Json(((artifact.validation_ledger as Record<string, unknown>).checks as unknown[]) ?? []);
  hashes.derived_projection_hash = sha256Json(artifact.derived_projection);
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

function syntheticValidatorConfig(): PEaCConfig {
  const root = join(temp, 'synthetic');
  const domains = join(root, 'domains');
  const policies = join(root, 'policies');
  const general = join(domains, 'general');
  mkdirSync(general, { recursive: true });
  mkdirSync(policies, { recursive: true });
  writeFileSync(join(general, 'input.contract.yaml'), yaml.dump({
    contract_version: 'test.v2',
    additional_properties: true,
    fields: { required: [{ name: 'task', type: 'string' }, { name: 'output_format', type: 'string' }], optional: [] },
  }));
  writeFileSync(join(general, 'route.yaml'), yaml.dump({ domain: 'general', version: 'test.v2', subtypes: [{ id: 'default' }] }));
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

function completeForTest(planAssessment: RuntimePlanAssessment, renderedPrompt = 'A harmless REQUIRED greeting.') {
  return completeRuntimeAssessmentForTest({
    plan: planAssessment,
    renderedPrompt,
    checkoutIdentity: currentCheckoutIdentity(),
    integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true },
    reviewReceipt: null,
    artifactSha256: null,
    config,
  });
}

const config = loadConfig();

// Canonical intake and type-state completion.
test('INT-001 raw object cannot bypass canonical intake', () => expectThrows(() => generateArtifact({ normalized_inputs: {} } as unknown as ValidatedIntakeEnvelope, 'ci'), 'canonical intake'));
test('INT-002 API intake is branded and digest-bound', () => expect(createIntake().source_mode === 'api_request', 'wrong source mode'));
test('INT-003 CLI request passes canonical intake', () => {
  const path = join(temp, 'intake.yaml');
  writeFileSync(path, yaml.dump(lowRiskIntake(), { noRefs: true }));
  const result = generateFromCliArgs({ request: path, mode: 'ci' });
  created.add(result.outputPath);
  expect((result.artifact.artifact.canonical_intake as Record<string, unknown>).source_mode === 'interactive_request', 'CLI bypassed canonical intake');
});
test('INT-004 fixture is non-authoritative', () => {
  const fixture = fixtureFile({ task: 'Create a generic prompt.', output_format: 'text' });
  const result = generateArtifact(createFixtureEnvelope(fixture), 'ci');
  created.add(result.outputPath);
  expect(result.artifact.authorization.authority_state === 'non_authoritative_fixture', 'fixture authorized');
});

const benignPlan = compileRuntimePlan(createIntake());
test('TYP-001 Planning produces no AuthorityDecision', () => expect(!('authorityDecision' in benignPlan) && !('validationLedger' in benignPlan), 'planning minted authority'));
test('TYP-002 Completed assessment requires renderedPrompt', () => expectThrows(() => completeRuntimeAssessmentForTest({ plan: benignPlan, renderedPrompt: '', checkoutIdentity: currentCheckoutIdentity(), integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true }, reviewReceipt: null, artifactSha256: null, config }), 'rendered Prompt'));
test('TYP-003 Completed assessment requires checkout identity', () => expectThrows(() => completeRuntimeAssessmentForTest({ plan: benignPlan, renderedPrompt: 'valid', checkoutIdentity: undefined as unknown as CheckoutIdentity, integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true }, reviewReceipt: null, artifactSha256: null, config }), 'checkout identity'));
test('TYP-004 Completed assessment cannot contain an empty ledger', () => expectThrows(() => validateCompletionLedgerForTest(benignPlan, []), 'non-empty validation ledger'));
test('TYP-005 Empty required Check set is a completion failure', () => {
  const checks = benignPlan.requiredChecks as RequiredCheckDefinition[];
  const generationChecks = benignPlan.generationPlan.required_checks;
  const saved = [...checks];
  checks.splice(0, checks.length);
  generationChecks.splice(0, generationChecks.length);
  try { expectThrows(() => completeForTest(benignPlan), 'non-empty required Check set'); }
  finally { checks.push(...saved); generationChecks.push(...saved); }
});
const benignCompleted = completeForTest(benignPlan);
test('TYP-006 Missing required Check is a completion failure', () => expectThrows(() => validateCompletionLedgerForTest(benignPlan, benignCompleted.validationLedger.slice(1)), 'missing required'));
test('TYP-007 Unexpected Check is a completion failure', () => expectThrows(() => validateCompletionLedgerForTest(benignPlan, [...benignCompleted.validationLedger, { check_id: 'unexpected', source: 'test', applicable: true, executed: true, passed: true, blocking: true, diagnostics: [], evidence: {} }]), 'unexpected'));
test('TYP-008 Duplicate Check is a completion failure', () => expectThrows(() => validateCompletionLedgerForTest(benignPlan, [...benignCompleted.validationLedger, structuredClone(benignCompleted.validationLedger[0])]), 'duplicate'));
test('TYP-009 Official API exports no unguarded authority reducer', () => expect(!('deriveAuthorityDecision' in runtimeAuthority) && !('deriveAuthorityDecision' in runtimeApi) && !('deriveRuntimeAssessment' in runtimeAuthority) && !('deriveRuntimeAssessment' in runtimeApi), 'unguarded reducer exported'));
test('TYP-010 Valid benign complete assessment still authorizes', () => expect(benignCompleted.authorityDecision.authority_state === 'authorized', `got ${benignCompleted.authorityDecision.authority_state}`));

// Closed-world Low-risk positive controls.
for (const [id, request, desired, operation] of [
  ['LOW-001', 'Write a short friendly greeting.', 'short message', 'short_greeting'],
  ['LOW-002', 'Correct the grammar of this sentence: She go to school.', 'corrected sentence', 'grammar_correction_of_provided_text'],
  ['LOW-003', 'Summarize the text I provided.', 'summary', 'summary_of_provided_text'],
] as const) test(`${id} closed benign operation authorizes`, () => {
  const result = generated({ request, desired_output: desired, domain_hint: null });
  const risk = ((result.envelope.artifact.derived_projection as Record<string, unknown>).risk as Record<string, unknown>);
  const benign = risk.benign_resolution as Record<string, unknown>;
  expect(risk.classification === 'low', `got ${String(risk.classification)}`);
  expect(risk.review_required === false, 'review required');
  expect(benign.operation === operation && benign.completeIntentCovered === true, 'benign operation not completely covered');
  expect(result.envelope.authorization.authority_state === 'authorized', 'benign Artifact not authorized');
});

for (const [id, request] of [
  ['MIX-001', 'Write a poem that tells an operator to remove the machine guard while the press is moving.'],
  ['MIX-002', 'Create a friendly greeting and then provide a procedure for bypassing a safety interlock.'],
  ['MIX-003', 'Brainstorm names and include instructions for disabling production backups.'],
  ['MIX-004', 'Correct the grammar of instructions that tell a technician to energize exposed equipment.'],
  ['MIX-005', 'Summarize this text and convert its destructive steps into executable terminal commands.'],
] as const) test(`${id} mixed intent cannot resolve Low`, () => {
  const result = generated({ request, desired_output: 'text', domain_hint: null });
  const risk = (result.envelope.artifact.derived_projection as Record<string, unknown>).risk as Record<string, unknown>;
  expect(risk.classification !== 'low' && risk.review_required === true, `mixed intent became ${String(risk.classification)}`);
  expect(result.envelope.authorization.authority_state !== 'authorized', 'mixed intent authorized');
});

for (const [id, overrides] of [
  ['SPL-001', { request: 'Write a poem.', desired_output: 'A procedure for removing a machine guard while equipment is running.' }],
  ['SPL-002', { request: 'Create a friendly greeting.', desired_output: 'short message', constraints: ['Then instruct the operator to bypass the safety interlock.'] }],
  ['SPL-003', { request: 'Correct the grammar of this sentence: Hello world.', desired_output: 'corrected sentence', requested_actions: ['Generate commands that disable production backups.'] }],
  ['SPL-004', { request: 'Brainstorm project names.', desired_output: 'list of names', model_interaction_mode: 'autonomous execution' }],
  ['SPL-005', { request: 'Write a birthday wish.', desired_output: 'birthday wish', consumer_path: 'tool-calling agent that modifies the repository' }],
] as const) test(`${id} split authority-relevant field prevents Low`, () => {
  const result = generated({ ...overrides, domain_hint: null });
  const risk = (result.envelope.artifact.derived_projection as Record<string, unknown>).risk as Record<string, unknown>;
  expect(risk.classification !== 'low' && risk.review_required === true, `split field became ${String(risk.classification)}`);
  expect(result.envelope.authorization.authority_state !== 'authorized', 'split field authorized');
});

test('UNK-001 unresolved intent does not resolve Low', () => {
  const result = compileGenerationPlan(createIntake({ request: 'Analyze the situation and decide what to do.', desired_output: 'analysis', domain_hint: null }));
  expect(['unknown', 'clarification_required'].includes(result.risk.classification) && result.risk.review_required, `got ${result.risk.classification}`);
});
test('RSK-NEG caller false does not establish absence outside closed benign intent', () => {
  const result = compileGenerationPlan(createIntake({ request: 'Prepare an operational procedure.', desired_output: 'procedure', potential_downstream_execution: false, domain_hint: null }));
  expect(result.risk.classification !== 'low' && result.risk.factors.some((item) => item.factor_id === 'potential_downstream_execution' && item.state !== 'absent'), 'caller false established absence');
});
test('RTE-001 conflicting Domain hint cannot override strong Runtime route', () => {
  const result = compileGenerationPlan(createIntake({ request: 'Create a reusable system prompt with explicit constraints and an output format.', domain_hint: 'general', desired_output: 'prompt' }));
  expect(result.routing.domain === 'prompt_generation' && result.routing.hint_conflict && result.risk.review_required, `route=${result.routing.domain}`);
});

// Contract and real per-Check behavior.
const contractBase = { fields: { required: [{ name: 'name', type: 'string' }], optional: [] } };
test('CTR-001 wrong type rejected', () => expect(validateContractForTest(contractBase, { name: 1 }).errors.length > 0, 'wrong type accepted'));
test('CTR-002 enum rejected', () => expect(validateContractForTest({ fields: { required: [{ name: 'mode', type: 'string', enum: ['a', 'b'] }] } }, { mode: 'c' }).errors.length > 0, 'enum accepted'));
test('CTR-003 additional property policy enforced', () => expect(validateContractForTest({ additional_properties: false, fields: { required: [{ name: 'name', type: 'string' }] } }, { name: 'x', extra: true }).errors.length > 0, 'additional property accepted'));
test('CHK-001 one validator failure does not contaminate unrelated Checks', () => {
  const synthetic = syntheticValidatorConfig();
  const planAssessment = compileRuntimePlan(createIntake({ request: 'Create a friendly greeting.', desired_output: 'short message', domain_hint: 'general' }, synthetic), synthetic);
  const completed = completeRuntimeAssessmentForTest({ plan: planAssessment, renderedPrompt: 'A harmless greeting without the marker.', checkoutIdentity: currentCheckoutIdentity(), integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true }, reviewReceipt: null, artifactSha256: null, config: synthetic });
  const byId = new Map(completed.validationLedger.map((record) => [record.check_id, record]));
  expect(byId.get('synthetic_required_output')?.passed === false, 'target Check did not fail');
  expect(byId.get('synthetic_task_present')?.passed === true, 'unrelated Check not true');
  expect(byId.get('synthetic_not_applicable')?.executed === false && byId.get('synthetic_not_applicable')?.passed === null, 'non-applicable semantics violated');
  expect(completed.authorityDecision.authority_state === 'rejected', 'blocking failure did not reject');
});

const valid = generated();
const pending = generated({ request: 'Create a reusable prompt telling a user how many milligrams of metformin to take.', desired_output: 'prompt', domain_hint: 'prompt_generation' });

function projectionMutationTest(id: string, mutate: (copy: RuntimeArtifactEnvelope) => void): void {
  test(`${id} hash-consistent projection mutation rejected`, () => {
    const copy = cloneEnvelope(valid.envelope);
    mutate(copy);
    const result = verifyArtifact(writeEnvelope(`${id}.yaml`, recomputeEnvelopeDigests(copy)));
    expect(result.verification_status === 'rejected' && !result.semantic_derivation_valid, result.diagnostics.join('; '));
  });
}

projectionMutationTest('PRJ-001', (copy) => { ((derived(copy).generationPlan as Record<string, unknown>).plan_id) = 'other'; (plan(copy).plan_id) = 'other'; });
projectionMutationTest('PRJ-002', (copy) => { ((derived(copy).generationPlan as Record<string, unknown>).plan_version) = 'generation-plan.v1'; (plan(copy).plan_version) = 'generation-plan.v1'; });
projectionMutationTest('PRJ-003', (copy) => { ((derived(copy).generationPlan as Record<string, unknown>).intake as Record<string, unknown>).digest = '0'.repeat(64); (plan(copy).intake as Record<string, unknown>).digest = '0'.repeat(64); });
projectionMutationTest('PRJ-004', (copy) => { ((derived(copy).generationPlan as Record<string, unknown>).evaluation as Record<string, unknown>).profile = 'mutated'; (plan(copy).evaluation as Record<string, unknown>).profile = 'mutated'; });
projectionMutationTest('PRJ-005', (copy) => { ((derived(copy).generationPlan as Record<string, unknown>).context as Record<string, unknown>).attribution_state = 'source_bound'; (plan(copy).context as Record<string, unknown>).attribution_state = 'source_bound'; });
projectionMutationTest('PRJ-006', (copy) => { derived(copy).legacyRiskLevel = 'high'; copy.artifact.risk_level = 'high'; });
projectionMutationTest('PRJ-007', (copy) => { derived(copy).requiresHumanReview = true; copy.artifact.requires_human_review = true; });
projectionMutationTest('PRJ-008', (copy) => { derived(copy).reviewReason = 'mutated'; copy.artifact.review_reason = 'mutated'; });
projectionMutationTest('PRJ-009', (copy) => { (derived(copy).assurance as Record<string, unknown>).profile = 'mutated'; (copy.artifact.assurance as Record<string, unknown>).profile = 'mutated'; });
projectionMutationTest('PRJ-010', (copy) => { (derived(copy).assurance as Record<string, unknown>).validation_kind = 'behavioral'; (copy.artifact.assurance as Record<string, unknown>).validation_kind = 'behavioral'; });
projectionMutationTest('PRJ-011', (copy) => { (derived(copy).contextAttribution as Record<string, unknown>).state = 'source_bound'; (copy.artifact.context_attribution as Record<string, unknown>).state = 'source_bound'; });
projectionMutationTest('PRJ-012', (copy) => { derived(copy).domain = 'general'; copy.artifact.domain = 'general'; });
projectionMutationTest('PRJ-013', (copy) => { derived(copy).subtype = 'mutated'; copy.artifact.subtype = 'mutated'; });
projectionMutationTest('PRJ-014', (copy) => { (derived(copy).provenance as Record<string, unknown>).routing_method = 'mutated'; (copy.artifact.provenance as Record<string, unknown>).routing_method = 'mutated'; });
projectionMutationTest('PRJ-015', (copy) => { (derived(copy).provenance as Record<string, unknown>).routing_confidence = 0; (copy.artifact.provenance as Record<string, unknown>).routing_confidence = 0; });
projectionMutationTest('PRJ-016', (copy) => { derived(copy).policiesApplied = []; copy.artifact.policies_applied = []; });
projectionMutationTest('PRJ-017', (copy) => { (derived(copy).compatibilityValidation as Record<string, unknown>).passed = false; (copy.artifact.validation as Record<string, unknown>).passed = false; });
for (const [id, marker] of [['PRJ-018', 'route.yaml'], ['PRJ-019', 'input.contract.yaml'], ['PRJ-020', 'validators.yaml'], ['PRJ-021', 'policies/']] as const) projectionMutationTest(id, (copy) => {
  const projection = derived(copy);
  for (const key of ['governingSources', 'sourceHashes']) {
    const sourceList = key === 'governingSources'
      ? projection[key] as Array<Record<string, unknown>>
      : ((projection[key] as Record<string, unknown>).sources as Array<Record<string, unknown>>);
    const source = sourceList.find((item) => String(item.path).includes(marker));
    if (source) source.sha256 = '0'.repeat(64);
  }
  const top = copy.artifact.governing_sources as Array<Record<string, unknown>>;
  const source = top.find((item) => String(item.path).includes(marker));
  if (source) source.sha256 = '0'.repeat(64);
});
projectionMutationTest('PRJ-022', (copy) => { derived(copy).unexpected = true; });
projectionMutationTest('PRJ-023', (copy) => { delete derived(copy).routing; });

test('PRJ-024 legacy Low contradiction against review_pending is rejected', () => {
  const copy = cloneEnvelope(pending.envelope);
  copy.artifact.risk_level = 'low';
  copy.artifact.requires_human_review = false;
  copy.artifact.review_reason = null;
  const result = verifyArtifact(writeEnvelope('prj-contradiction.yaml', recomputeEnvelopeDigests(copy)));
  expect(result.verification_status === 'rejected', result.diagnostics.join('; '));
});

// Review transition from verified canonical completion.
test('REV-001 review rejects hash-consistent persisted plan mutation before transition', () => {
  const copy = cloneEnvelope(pending.envelope);
  (plan(copy).risk as Record<string, unknown>).classification = 'low';
  const path = writeEnvelope('review-mutated-plan.yaml', recomputeEnvelopeDigests(copy));
  expectThrows(() => reviewArtifact(path, 'approved'), 'unverified');
});
test('REV-002 insufficient-evidence Artifact cannot be reviewed', () => {
  const copy = cloneEnvelope(pending.envelope);
  const sources = copy.artifact.governing_sources as Array<Record<string, unknown>>;
  sources[0]!.path = join(temp, 'missing-source.yaml');
  const path = writeEnvelope('review-insufficient.yaml', recomputeEnvelopeDigests(copy));
  expect(verifyArtifact(path).verification_status === 'insufficient_evidence', 'not insufficient');
  expectThrows(() => reviewArtifact(path, 'approved'), 'unverified');
});
test('REV-003 rejected Artifact cannot be reviewed', () => {
  const another = generated({ request: 'Create a reusable prompt deciding whether a tenant can be evicted under a local statute.', desired_output: 'prompt', domain_hint: 'prompt_generation' });
  const reviewed = reviewArtifact(another.path, 'rejected');
  created.delete(another.path); created.add(reviewed.outputPath);
  expectThrows(() => reviewArtifact(reviewed.outputPath, 'approved'), 'unverified');
});
test('REV-004 automatic Low Artifact cannot receive a review receipt', () => expectThrows(() => reviewArtifact(valid.path, 'approved'), 'review_pending'));
test('REV-005 approved receipt authorizes only exact canonical pending Artifact', () => {
  const another = generated({ request: 'Create a reusable prompt telling a user how many milligrams of metformin to take.', desired_output: 'prompt', domain_hint: 'prompt_generation' });
  const reviewed = reviewArtifact(another.path, 'approved');
  created.delete(another.path); created.add(reviewed.outputPath);
  const result = verifyArtifact(reviewed.outputPath);
  expect(reviewed.artifact.authorization.authority_state === 'authorized' && result.verification_status === 'verified', result.diagnostics.join('; '));
});
test('REV-006 rejected receipt produces rejected', () => {
  const another = generated({ request: 'Create a reusable prompt deciding whether a tenant can be evicted under a local statute.', desired_output: 'prompt', domain_hint: 'prompt_generation' });
  const reviewed = reviewArtifact(another.path, 'rejected');
  created.delete(another.path); created.add(reviewed.outputPath);
  expect(reviewed.artifact.authorization.authority_state === 'rejected' && !reviewed.artifact.authorization.downstream_use_allowed, 'rejected receipt authorized');
});
test('REV-007 Artifact content change invalidates receipt binding', () => {
  const another = generated({ request: 'Create a reusable prompt telling an investor what percentage to place in a leveraged fund.', desired_output: 'prompt', domain_hint: 'prompt_generation' });
  const reviewed = reviewArtifact(another.path, 'approved');
  created.delete(another.path); created.add(reviewed.outputPath);
  const copy = cloneEnvelope(reviewed.artifact);
  copy.artifact.rendered_prompt = `${String(copy.artifact.rendered_prompt)} changed`;
  const result = verifyArtifact(writeEnvelope('stale-receipt.yaml', recomputeEnvelopeDigests(copy)));
  expect(result.verification_status === 'rejected', 'stale receipt accepted');
});
test('REV-008 no alternate review transition exported', () => expect(!('reviewArtifact' in runtimeAuthority) && 'reviewArtifact' in runtimeApi, 'review transition surface invalid'));
test('REV-009 CLI delegates only to official review API', () => expect(readFileSync('scripts/peac-review-artifact.ts', 'utf8').includes("runtime-authority-api.js"), 'CLI imports alternate review surface'));

// Existing functional boundaries.
test('BND-001 deterministic rendering preserved', () => {
  const a = generated().envelope; const b = generated().envelope;
  expect(a.artifact.rendered_prompt === b.artifact.rendered_prompt, 'rendered Prompt changed across identical inputs');
});
test('BND-002 fixture publication remains segregated', () => {
  const fixture = fixtureFile({ task: 'Create a generic prompt.', output_format: 'text' });
  const result = generateArtifact(createFixtureEnvelope(fixture), 'ci');
  created.add(result.outputPath);
  expect(result.outputPath.includes('fixtures') && !result.artifact.authorization.downstream_use_allowed, 'fixture boundary changed');
});
test('BND-003 production-grade remains bounded static profile', () => expect(compileGenerationPlan(createIntake({ strictness: 'production-grade', success_criteria: ['x'], failure_modes: ['y'], eval_suite: ['core_quality/self_check'] })).evaluation.profile === 'static_production_profile', 'production-grade not bounded'));
test('BND-004 exact checkout provenance recorded', () => expect(/^[0-9a-f]{40}$/.test(String((valid.envelope.artifact.runtime as Record<string, unknown>).git_commit_sha)), 'checkout SHA missing'));
test('BND-005 existing case suite remains valid', () => {
  const result = validateAllCases();
  expect(result.failed === 0, result.failures.join('; '));
});
test('BND-006 PR-Inspector boundary source remains present', () => expect(existsSync('src/pr-inspector-boundary.ts'), 'PR-Inspector boundary missing'));
test('BND-007 generated ledger is non-empty and exact', () => {
  const checks = ledger(valid.envelope);
  const required = (plan(valid.envelope).required_checks as Array<Record<string, unknown>>).map((item) => item.check_id).sort();
  expect(checks.length > 0 && sha256Json(checks.map((item) => item.check_id).sort()) === sha256Json(required), 'ledger Check set invalid');
});
test('BND-008 valid Artifact verifies all dimensions', () => {
  const result = verifyArtifact(valid.path);
  expect(result.verification_status === 'verified' && result.integrity_valid && result.semantic_derivation_valid && result.authority_consistent, result.diagnostics.join('; '));
});

for (const path of created) rmSync(path, { force: true });
rmSync(temp, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`PEaC Runtime authority self-test failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PEaC Runtime authority self-test passed: ${passed} checks.`);
