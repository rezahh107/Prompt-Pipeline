#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import {
  compileRuntimePlan,
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
import { buildCanonicalDerivedProjection } from '../src/runtime-authority-artifact.js';
import {
  completeRuntimeAssessmentForTest,
  currentCheckoutIdentity,
  enforceConstraints,
  renderThroughStagedLegacy,
} from '../src/runtime-authority-execution.js';
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

// WU-PP32-FINAL-001 — A-M3 parallel-authority removal.
function authorityImplementationInventory(sources: Record<string, string>): Record<string, string[]> {
  const operations: Record<string, string[]> = {
    generateArtifact: [],
    verifyArtifact: [],
    verifyArtifactForReviewInternal: [],
    reviewArtifact: [],
  };
  for (const [path, source] of Object.entries(sources)) {
    for (const operation of Object.keys(operations)) {
      const pattern = new RegExp(`export\\s+function\\s+${operation}\\s*\\(`, 'g');
      if (pattern.test(source)) operations[operation]!.push(path);
    }
  }
  return operations;
}

function assertCanonicalAuthorityInventory(sources: Record<string, string>): void {
  const inventory = authorityImplementationInventory(sources);
  const expected: Record<string, string> = {
    generateArtifact: 'src/runtime-authority-canonical-artifact.ts',
    verifyArtifact: 'src/runtime-authority-verification-facts.ts',
    verifyArtifactForReviewInternal: 'src/runtime-authority-verification-facts.ts',
    reviewArtifact: 'src/runtime-authority-api.ts',
  };
  for (const [operation, owner] of Object.entries(expected)) {
    const observed = inventory[operation] ?? [];
    if (observed.length !== 1 || observed[0] !== owner) {
      throw new Error(`unexpected parallel authority implementation: ${operation}=${observed.join(',') || 'none'}; expected=${owner}`);
    }
  }
}

test('T-AUTH-01', () => {
  const paths = [
    'src/runtime-authority-artifact.ts',
    'src/runtime-authority-canonical-artifact.ts',
    'src/runtime-authority-verification-facts.ts',
    'src/runtime-authority-api.ts',
  ];
  const sources = Object.fromEntries(paths.map((path) => [path, readFileSync(path, 'utf8')]));
  assertCanonicalAuthorityInventory(sources);
  expect(/export\s+function\s+buildCanonicalDerivedProjection\s*\(/.test(sources['src/runtime-authority-artifact.ts']!), 'pure projection builder missing');
  expect(!/generateFromCliArgs|verifyArtifact|generateArtifact|reviewArtifact/.test(sources['src/runtime-authority-artifact.ts']!), 'projection module retained authority operation');
  expectThrows(() => assertCanonicalAuthorityInventory({
    ...sources,
    'synthetic/parallel.ts': 'export function verifyArtifact() {}',
  }), 'unexpected parallel authority implementation');
});

test('T-AUTH-02', () => {
  const fixture = join(process.cwd(), 'scripts', `.obsolete-authority-${process.pid}-${++sequence}.type-test.ts`);
  writeFileSync(fixture, [
    '// @ts-expect-error obsolete authority Symbol is not exported',
    "import { generateArtifact } from '../src/runtime-authority-artifact.js';",
    '// @ts-expect-error obsolete authority Symbol is not exported',
    "import { verifyArtifact } from '../src/runtime-authority-artifact.js';",
    '// @ts-expect-error obsolete authority Symbol is not exported',
    "import { verifyArtifactForReviewInternal } from '../src/runtime-authority-artifact.js';",
    '// @ts-expect-error obsolete authority Symbol is not exported',
    "import { generateFromCliArgs } from '../src/runtime-authority-artifact.js';",
    'void [generateArtifact, verifyArtifact, verifyArtifactForReviewInternal, generateFromCliArgs];',
  ].join('\n'));
  try {
    execFileSync(process.execPath, [
      join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit',
      '--target', 'ES2022',
      '--module', 'ESNext',
      '--moduleResolution', 'Bundler',
      '--strict',
      '--skipLibCheck',
      '--esModuleInterop',
      '--resolveJsonModule',
      fixture,
    ], { cwd: process.cwd(), stdio: 'pipe' });
  } finally {
    rmSync(fixture, { force: true });
  }
});

test('T-AUTH-03', () => {
  const valid = generated();
  expect(verifyArtifact(valid.outputPath, valid.config).verification_status === 'verified', 'official verification path failed');
  const pending = generated({
    request: 'Create a reusable prompt deciding whether a tenant can be evicted under a local statute.',
    desired_output: 'prompt',
    domain_hint: 'prompt_generation',
  });
  expect(pending.artifact.authorization.authority_state === 'review_pending', 'official generation did not produce review_pending');
  const reviewed = reviewArtifact(pending.outputPath, 'rejected', [], pending.config);
  expect(reviewed.artifact.authorization.authority_state === 'rejected', 'official review transition failed');
});

test('T-AUTH-04', () => {
  const config = configFor('projection-equality');
  const envelope = intake({}, config);
  const generatedArtifact = generateArtifact(envelope, 'ci', config).artifact;
  const plan = compileRuntimePlan(envelope, config);
  const renderedPrompt = enforceConstraints(
    String(renderThroughStagedLegacy(plan, 'ci', config).rendered_prompt ?? ''),
    plan,
  );
  const completed = completeRuntimeAssessmentForTest({
    plan,
    renderedPrompt,
    checkoutIdentity: currentCheckoutIdentity(),
    integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true },
    reviewReceipt: null,
    artifactSha256: null,
    config,
  });
  expect(
    sha256Json(buildCanonicalDerivedProjection(completed)) === sha256Json(generatedArtifact.artifact.derived_projection),
    'canonical Derived Projection changed',
  );
});

// WU-PP32-FINAL-001 — B-M2 topic-bearing payload proof.
test('T-TOPIC-01', () => {
  for (const [request, desiredOutput] of [
    ['Brainstorm names for blackmail.', 'list of names'],
    ['Write a poem about coercing witnesses.', 'poem'],
    ['Brainstorm names for silent account takeover.', 'list of names'],
  ] as const) {
    const result = generated({ request, desired_output: desiredOutput });
    const assessment = risk(result.artifact).payload_assessment as Record<string, unknown>;
    expect(assessment.kind === 'inline_free_form', `${request}: payload kind=${String(assessment.kind)}`);
    expect(assessment.provenBenign === false, `${request}: topic payload was proven benign`);
    expect((assessment.unresolvedReasons as string[]).some((item) => item.includes('payload_kind_not_allowed')), `${request}: missing policy diagnostic`);
    assertNotLow(result.artifact);
  }
});

test('T-TOPIC-02', () => {
  for (const [request, desiredOutput] of [
    ['Write a poem.', 'poem'],
    ['Brainstorm project names.', 'list of names'],
  ] as const) {
    const result = generated({ request, desired_output: desiredOutput });
    const assessment = risk(result.artifact).payload_assessment as Record<string, unknown>;
    expect(risk(result.artifact).classification === 'low', `${request}: not Low`);
    expect(assessment.kind === 'none' && assessment.provenBenign === true, `${request}: no-topic payload not proven`);
    expect(result.artifact.authorization.authority_state === 'authorized', `${request}: not authorized`);
  }
});

test('T-TOPIC-03', () => {
  const result = generated({
    request: 'Correct the grammar of this sentence: She go to school.',
    desired_output: 'corrected sentence',
  });
  const assessment = risk(result.artifact).payload_assessment as Record<string, unknown>;
  expect(assessment.kind === 'bounded_literal' && assessment.provenBenign === true, 'bounded grammar behavior regressed');
  expect(risk(result.artifact).classification === 'low' && result.artifact.authorization.authority_state === 'authorized', 'bounded grammar no longer authorizes');
});

test('T-TOPIC-04', () => expectThrows(() => syntheticPolicyInventoryFailureForTest(), 'payload policy inventory mismatch'));

// WU-PP32-FINAL-001 — C-M2 source-independent precedence.
test('T-VERIFY-01', () => {
  const unavailable = unavailableEvidenceFixture();
  const mutations: Array<[string, (copy: RuntimeArtifactEnvelope) => void]> = [
    ['canonical_intake/base', (copy) => { (copy.artifact.canonical_intake as Record<string, unknown>).raw_request_digest = '0'.repeat(64); }],
    ['execution_mode/context', (copy) => { copy.artifact.execution_mode = 'batch'; }],
    ['prompt_id/identity', (copy) => { copy.artifact.prompt_id = 'drifted.prompt'; }],
    ['generation plan', (copy) => { (copy.artifact.generation_plan as Record<string, unknown>).plan_id = 'drifted'; }],
    ['validation ledger', (copy) => { ((copy.artifact.validation_ledger as Record<string, unknown>).checks as unknown[]).push({ check_id: 'drifted' }); }],
    ['compatibility validation', (copy) => { (copy.artifact.validation as Record<string, unknown>).passed = false; }],
    ['domain', (copy) => { copy.artifact.domain = 'drifted'; }],
    ['subtype', (copy) => { copy.artifact.subtype = 'drifted'; }],
    ['provenance', (copy) => { (copy.artifact.provenance as Record<string, unknown>).routing_method = 'drifted'; }],
    ['policies', (copy) => { (copy.artifact.policies_applied as unknown[]).push({ id: 'drifted' }); }],
    ['risk', (copy) => { copy.artifact.risk_level = 'high'; }],
    ['review flag', (copy) => { copy.artifact.requires_human_review = true; }],
    ['review reason', (copy) => { copy.artifact.review_reason = 'drifted'; }],
    ['assurance', (copy) => { (copy.artifact.assurance as Record<string, unknown>).profile = 'drifted'; }],
    ['context attribution', (copy) => { (copy.artifact.context_attribution as Record<string, unknown>).state = 'source_bound'; }],
    ['governing source mirror', (copy) => { (((copy.artifact.derived_projection as Record<string, unknown>).governingSources as Array<Record<string, unknown>>)[0]!).sha256 = '0'.repeat(64); }],
    ['source hash mirror', (copy) => { (((((copy.artifact.derived_projection as Record<string, unknown>).sourceHashes as Record<string, unknown>).sources as Array<Record<string, unknown>>)[0]!)).sha256 = '0'.repeat(64); }],
    ['authorization', (copy) => { copy.authorization.downstream_use_allowed = false; }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = clone(unavailable.artifact);
    mutate(copy);
    const result = verifyArtifact(writeEnvelope(`t-verify-01-${label.replace(/[^a-z0-9]+/gi, '-')}.yaml`, recompute(copy)), unavailable.config);
    expect(result.verification_status === 'rejected', `${label}: ${result.verification_status}; ${result.diagnostics.join('; ')}`);
    expect(result.diagnostics.some((item) => /mirror|invariant|authorization/i.test(item)), `${label}: named source-independent contradiction missing`);
  }
});

test('T-VERIFY-02', () => {
  const unavailable = unavailableEvidenceFixture();
  const result = verifyArtifact(unavailable.path, unavailable.config);
  expect(result.verification_status === 'insufficient_evidence', result.diagnostics.join('; '));
  expect(result.diagnostics.some((item) => item.includes('Canonical expected governing source is unavailable')), 'canonical absence diagnostic missing');
});

test('T-VERIFY-03', () => {
  const valid = generated();
  const result = verifyArtifact(valid.outputPath, valid.config);
  expect(result.verification_status === 'verified', result.diagnostics.join('; '));
  expect(result.integrity_valid && result.semantic_derivation_valid && result.authority_consistent, 'valid verification dimensions failed');
  expect(result.diagnostics.length === 0, `valid Artifact diagnostics: ${result.diagnostics.join('; ')}`);
});

test('T-VERIFY-04', () => {
  const rejectedPath = writeEnvelope('t-verify-04-rejected.yaml', {});
  expectThrows(() => reviewArtifact(rejectedPath, 'approved'), 'Cannot review an unverified Artifact');
  const insufficient = unavailableEvidenceFixture();
  const before = insufficient.path;
  expectThrows(() => reviewArtifact(before, 'approved', [], insufficient.config), 'Cannot review an unverified Artifact');
  expect(existsSync(before), 'insufficient Artifact was moved despite review refusal');
});

test('T-REG-01', () => {
  const runner = readFileSync('scripts/peac-runtime-authority-ci.ts', 'utf8');
  expect(runner.includes('peac-runtime-authority-self-test.ts'), 'legacy Runtime self-test was removed from the Regression runner');
  expect(runner.includes('peac-runtime-authority-evidence-lock-test.ts'), 'Evidence-Lock suite was removed from the Regression runner');
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
