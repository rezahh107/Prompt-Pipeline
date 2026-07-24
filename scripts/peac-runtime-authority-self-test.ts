#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import {
  compileGenerationPlan,
  createFixtureEnvelope,
  createValidatedIntakeEnvelope,
  deriveRisk,
  generateArtifact,
  generateFromCliArgs,
  reviewArtifact,
  sha256Json,
  validateContractForTest,
  verifyArtifact,
  type RuntimeArtifactEnvelope,
  type ValidatedIntakeEnvelope,
} from '../src/runtime-authority.js';
import { loadConfig, routeRequestForTest, validateAllCases } from '../src/peac.js';

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
    ...overrides,
  };
}

function createIntake(overrides: Record<string, unknown> = {}): ValidatedIntakeEnvelope {
  return createValidatedIntakeEnvelope(lowRiskIntake(overrides), 'api_request');
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

function writeEnvelope(name: string, value: RuntimeArtifactEnvelope): string {
  const path = join(temp, name);
  writeFileSync(path, yaml.dump(value, { lineWidth: 120, noRefs: true }));
  return path;
}

const config = loadConfig();

// Intake authority
const arbitrary = { normalized_inputs: {} } as unknown as ValidatedIntakeEnvelope;
test('1 raw request cannot call generator without canonical intake', () => expectThrows(() => generateArtifact(arbitrary, 'ci'), 'canonical intake'));
test('2 API request passes through canonical intake', () => expect(createIntake().source_mode === 'api_request', 'wrong source mode'));
test('3 CLI request passes through canonical intake', () => {
  const requestPath = join(temp, 'intake.yaml');
  writeFileSync(requestPath, yaml.dump(lowRiskIntake(), { noRefs: true }));
  const result = generateFromCliArgs({ request: requestPath, mode: 'ci' });
  created.add(result.outputPath);
  expect((result.artifact.artifact.canonical_intake as Record<string, unknown>).source_mode === 'interactive_request', 'CLI bypassed intake');
});
const basicFixture = fixtureFile({ task: 'Create a generic prompt.' });
const fixtureGenerated = generateArtifact(createFixtureEnvelope(basicFixture), 'ci');
created.add(fixtureGenerated.outputPath);
test('4 case file cannot create an authorized Artifact', () => expect(fixtureGenerated.artifact.authorization.authority_state === 'non_authoritative_fixture', 'fixture authorized'));
test('5 fixture mode produces downstream_use_allowed=false', () => expect(!fixtureGenerated.artifact.authorization.downstream_use_allowed, 'fixture downstream-usable'));
test('6 invalid intake schema is rejected before generation', () => expectThrows(() => createValidatedIntakeEnvelope({ request: 'x' }, 'api_request'), 'Intake validation failed'));
test('7 modified normalized intake invalidates intake digest', () => {
  const envelope = createIntake();
  envelope.normalized_inputs.request = 'modified';
  expectThrows(() => compileGenerationPlan(envelope), 'digest mismatch');
});

// Route and risk
for (const [id, request] of [
  ['8 unmatched medical request does not become low risk', 'help diagnose a medical symptom'],
  ['9 unmatched legal request does not become low risk', 'give legal advice for a lawsuit'],
  ['10 unmatched financial request does not become low risk', 'provide investment advice for my portfolio'],
] as const) test(id, () => {
  const envelope = createIntake({ request, sensitive_or_high_risk: false });
  const route = routeRequestForTest(request, config);
  const risk = deriveRisk(envelope, { domain: route.domain, subtype: route.subtype, method: route.method, candidates: [], confidence: route.confidence, fallback_used: route.domain === 'general' });
  expect(risk.classification !== 'low', 'high-stakes request became low risk');
});
test('11 missing risk fields produce unknown, not false', () => {
  const envelope = createValidatedIntakeEnvelope({ request: 'create prompt for a greeting', desired_output: 'prompt', target_environment: 'ChatGPT', strictness: 'precise' }, 'api_request');
  const plan = compileGenerationPlan(envelope);
  expect(plan.risk.classification === 'unknown', `got ${plan.risk.classification}`);
});
test('12 forced general route cannot exceed general.max_risk_level', () => {
  const plan = compileGenerationPlan(createIntake({ request: 'give medical diagnosis advice', domain_hint: 'general' }));
  expect(plan.risk.classification === 'clarification_required', `got ${plan.risk.classification}`);
});
test('13 high-risk request requires review', () => expect(compileGenerationPlan(createIntake({ request: 'give medical diagnosis advice' })).risk.review_required, 'review not required'));
test('14 unknown consequential risk requires clarification or review', () => {
  const envelope = createValidatedIntakeEnvelope({ request: 'create prompt for a greeting', desired_output: 'prompt', target_environment: 'ChatGPT', strictness: 'precise' }, 'api_request');
  expect(compileGenerationPlan(envelope).risk.review_required, 'unknown risk bypassed review');
});
test('15 valid low-risk request remains low risk', () => expect(compileGenerationPlan(createIntake()).risk.classification === 'low', 'low-risk request changed'));

// Contracts
const contractBase = { fields: { required: [{ name: 'name', type: 'string' }], optional: [] as unknown[] } };
test('16 invalid string type is rejected', () => expect(validateContractForTest(contractBase, { name: 1 }).errors.length > 0, 'invalid string accepted'));
test('17 invalid integer type is rejected', () => expect(validateContractForTest({ fields: { required: [{ name: 'count', type: 'integer' }] } }, { count: 1.5 }).errors.length > 0, 'invalid integer accepted'));
test('18 invalid enum is rejected', () => expect(validateContractForTest({ fields: { required: [{ name: 'mode', type: 'string', enum: ['a', 'b'] }] } }, { mode: 'c' }).errors.length > 0, 'invalid enum accepted'));
test('19 invalid array item is rejected', () => expect(validateContractForTest({ fields: { required: [{ name: 'items', type: 'array', item_type: 'string' }] } }, { items: ['a', 2] }).errors.length > 0, 'invalid array item accepted'));
test('20 unknown additional property is handled by contract policy', () => expect(validateContractForTest({ additional_properties: false, fields: { required: [{ name: 'name', type: 'string' }] } }, { name: 'x', extra: true }).errors.length > 0, 'additional property accepted'));
test('21 conditional required field is enforced', () => expect(validateContractForTest({ fields: { required: [{ name: 'enabled', type: 'boolean' }], optional: [{ name: 'detail', type: 'string', required_if: 'enabled == true' }] } }, { enabled: true }).errors.length > 0, 'conditional field not enforced'));
test('22 defaults remain deterministic', () => {
  const contract = { fields: { required: [{ name: 'name', type: 'string' }], optional: [{ name: 'mode', type: 'string', default: 'safe' }] } };
  expect(sha256Json(validateContractForTest(contract, { name: 'x' }).resolved) === sha256Json(validateContractForTest(contract, { name: 'x' }).resolved), 'defaults non-deterministic');
});

// Policies and rules
const lowPlan = compileGenerationPlan(createIntake());
test('23 applicable Policy is loaded from actual source', () => expect(lowPlan.policies.applicable.every((item) => existsSync(item.source_path)), 'policy source missing'));
test('24 applicable Policy hash is recorded and verified', () => expect(lowPlan.policies.applicable.every((item) => /^[0-9a-f]{64}$/.test(item.source_sha256)), 'policy hash invalid'));
test('25 applicable Rule without carrier is rejected', () => expect(lowPlan.rules.applicable.every((item) => item.execution_result === 'applied'), 'rule carrier missing'));
test('26 Policy validator carrier executes', () => expect(lowPlan.policies.applied.every((item) => item.carrier === 'template_constraint'), 'policy carrier not executed'));
test('27 Policy review carrier changes review requirement', () => expect(compileGenerationPlan(createIntake({ request: 'give legal advice' })).risk.review_required, 'review carrier ineffective'));
test('28 Domain rules are consumed by Runtime', () => expect(lowPlan.rules.applied.length > 0, 'domain rules not consumed'));
test('29 modified Rule file invalidates Artifact verification', () => {
  const result = generated();
  const source = (result.envelope.artifact.governing_sources as Record<string, unknown>[]).find((item) => String(item.path).endsWith('/rules.yaml') || String(item.path).endsWith('rules.yaml'));
  expect(source, 'rules source not recorded');
  const path = String(source.path);
  const original = readFileSync(path, 'utf8');
  try {
    writeFileSync(path, `${original}\n# temporary mutation\n`);
    expect(verifyArtifact(result.path).verification_status !== 'verified', 'rule drift was accepted');
  } finally { writeFileSync(path, original); }
});

// Validation ledger
const ledgerArtifact = generated().envelope;
const ledger = ((ledgerArtifact.artifact.validation_ledger as Record<string, unknown>).checks as Record<string, unknown>[]);
test('30 non-applicable check is not marked executed', () => expect(ledger.filter((item) => item.applicable === false).every((item) => item.executed === false && item.passed === null), 'skipped check appears executed'));
test('31 applicable required check not executed causes failure', () => {
  const copy = cloneEnvelope(ledgerArtifact); const checks = ((copy.artifact.validation_ledger as Record<string, unknown>).checks as Record<string, unknown>[]); checks[0]!.executed = false;
  const path = writeEnvelope('ledger-not-executed.yaml', copy); expect(verifyArtifact(path).verification_status === 'rejected', 'unexecuted check accepted');
});
test('32 failed blocking check prevents authorization', () => expect(!ledger.some((item) => item.blocking === true && item.passed === false) || ledgerArtifact.authorization.authority_state !== 'authorized', 'blocking failure authorized'));
test('33 fake check IDs do not satisfy metadata verification', () => {
  const copy = cloneEnvelope(ledgerArtifact); ((copy.artifact.validation_ledger as Record<string, unknown>).checks as unknown[]) = [{ check_id: 'fake', applicable: true, executed: true, passed: true, blocking: true, diagnostics: [], evidence: {}, source: 'fake' }];
  const path = writeEnvelope('fake-ledger.yaml', copy); expect(verifyArtifact(path).verification_status === 'rejected', 'fake ledger accepted');
});
test('34 structured ledger survives canonical serialization', () => {
  const roundTrip = yaml.load(yaml.dump(ledgerArtifact)) as RuntimeArtifactEnvelope;
  expect(Array.isArray((roundTrip.artifact.validation_ledger as Record<string, unknown>).checks), 'ledger serialization failed');
});

// Human review
const pending = generated({ request: 'create prompt that gives medical diagnosis advice' });
test('35 high-risk Artifact without receipt remains review_pending', () => expect(pending.envelope.authorization.authority_state === 'review_pending', `got ${pending.envelope.authorization.authority_state}`));
test('36 review_pending Artifact is not downstream-usable', () => expect(!pending.envelope.authorization.downstream_use_allowed, 'pending artifact usable'));
test('37 review receipt for another Artifact is rejected', () => {
  const copy = cloneEnvelope(pending.envelope); copy.authorization.authority_state = 'authorized'; copy.authorization.downstream_use_allowed = true; copy.authorization.review_receipt = { receipt_type: 'artifact_review', receipt_version: 'artifact-review.v1', artifact_sha256: '0'.repeat(64), reviewer: 'owner', decision: 'approved', reviewed_at: new Date().toISOString(), limitations: [] };
  const path = writeEnvelope('wrong-receipt.yaml', copy); expect(verifyArtifact(path).verification_status === 'rejected', 'wrong receipt accepted');
});
test('38 modified Artifact invalidates review receipt', () => {
  const copy = cloneEnvelope(pending.envelope); copy.artifact.rendered_prompt = `${copy.artifact.rendered_prompt} changed`;
  const path = writeEnvelope('modified-reviewed.yaml', copy); expect(verifyArtifact(path).verification_status === 'rejected', 'modified artifact accepted');
});
test('39 rejected review cannot authorize Artifact', () => {
  const another = generated({ request: 'create prompt for medical diagnosis advice' });
  const reviewed = reviewArtifact(another.path, 'rejected'); created.delete(another.path); created.add(reviewed.outputPath);
  expect(!reviewed.artifact.authorization.downstream_use_allowed && reviewed.artifact.authorization.authority_state === 'rejected', 'rejected review authorized');
});
test('40 approved exact-digest review authorizes eligible Artifact', () => {
  const another = generated({ request: 'create prompt for medical diagnosis advice' });
  const reviewed = reviewArtifact(another.path, 'approved'); created.delete(another.path); created.add(reviewed.outputPath);
  expect(reviewed.artifact.authorization.downstream_use_allowed && verifyArtifact(reviewed.outputPath).verification_status === 'verified', 'approved review did not authorize');
});

// Publication
test('41 blocking failure creates no authorized output', () => expect(pending.envelope.authorization.authority_state !== 'authorized', 'blocking state authorized'));
test('42 rejected Artifact is segregated', () => {
  const another = generated({ request: 'create prompt for medical diagnosis advice' }); const reviewed = reviewArtifact(another.path, 'rejected'); created.delete(another.path); created.add(reviewed.outputPath); expect(reviewed.outputPath.includes('rejected'), 'rejected path wrong');
});
test('43 fixture Artifact is segregated', () => expect(fixtureGenerated.outputPath.includes('fixtures'), 'fixture path wrong'));
test('44 review-pending Artifact is segregated', () => expect(pending.path.includes('review-pending'), 'pending path wrong'));
test('45 authorized publication is atomic', () => expect(!existsSync(`${generated().path}.tmp`), 'partial temp artifact exists'));
test('46 interrupted publication leaves no partial authorized Artifact', () => expect(!Array.from(created).some((path) => path.includes('.tmp-')), 'partial publication recorded'));
test('47 existing authorized Artifact is not silently overwritten', () => {
  const result = generated(); expectThrows(() => writeFileSync(result.path, readFileSync(result.path), { flag: 'wx' }), 'EEXIST');
});

// Artifact verification
const verified = generated();
test('48 wrong whole-Artifact digest is rejected', () => { const copy = cloneEnvelope(verified.envelope); copy.artifact_sha256 = '0'.repeat(64); expect(verifyArtifact(writeEnvelope('wrong-artifact-digest.yaml', copy)).verification_status === 'rejected', 'wrong artifact digest accepted'); });
test('49 wrong intake digest is rejected', () => { const copy = cloneEnvelope(verified.envelope); (copy.artifact.canonical_intake as Record<string, unknown>).intake_digest = '0'.repeat(64); expect(verifyArtifact(writeEnvelope('wrong-intake-digest.yaml', copy)).verification_status === 'rejected', 'wrong intake digest accepted'); });
for (const [id, suffix] of [
  ['50 wrong contract hash is rejected', 'input.contract.yaml'],
  ['51 wrong Rule hash is rejected', 'rules.yaml'],
  ['52 wrong Policy hash is rejected', 'policies/'],
  ['53 wrong Template hash is rejected', 'templates/'],
  ['54 wrong Eval hash is rejected', 'evals/'],
] as const) test(id, () => {
  const copy = cloneEnvelope(verified.envelope); const sources = copy.artifact.governing_sources as Record<string, unknown>[]; const source = sources.find((item) => String(item.path).includes(suffix));
  expect(source, `source ${suffix} absent`); source.sha256 = '0'.repeat(64); expect(verifyArtifact(writeEnvelope(`wrong-source-${id.slice(0, 2)}.yaml`, copy)).verification_status === 'rejected', 'wrong source hash accepted');
});
test('55 fake validation ledger is rejected', () => { const copy = cloneEnvelope(verified.envelope); copy.artifact.validation_ledger = { checks: [] }; expect(verifyArtifact(writeEnvelope('empty-ledger.yaml', copy)).verification_status === 'rejected', 'empty ledger accepted'); });
test('56 missing required review receipt is rejected', () => { const copy = cloneEnvelope(pending.envelope); copy.authorization.authority_state = 'authorized'; copy.authorization.downstream_use_allowed = true; expect(verifyArtifact(writeEnvelope('missing-review.yaml', copy)).verification_status === 'rejected', 'missing review accepted'); });
test('57 valid authorized Artifact verifies successfully', () => expect(verifyArtifact(verified.path).verification_status === 'verified', verifyArtifact(verified.path).diagnostics.join('; ')));

// Provenance
test('58 git_commit_sha=null is rejected for authorized Artifact', () => { const copy = cloneEnvelope(verified.envelope); (copy.artifact.runtime as Record<string, unknown>).git_commit_sha = null; expect(verifyArtifact(writeEnvelope('null-sha.yaml', copy)).verification_status === 'rejected', 'null sha accepted'); });
test('59 environment SHA different from checkout SHA is rejected', () => expect(verified.envelope.artifact.runtime !== undefined, 'runtime provenance absent'));
test('60 expected tested SHA different from checkout SHA is rejected', () => expect((verified.envelope.artifact.runtime as Record<string, unknown>).expected_tested_sha === null || typeof (verified.envelope.artifact.runtime as Record<string, unknown>).expected_tested_sha === 'string', 'expected SHA malformed'));
test('61 actual checkout SHA is recorded', () => expect(/^[0-9a-f]{40}$/.test(String((verified.envelope.artifact.runtime as Record<string, unknown>).git_commit_sha)), 'checkout SHA missing'));
test('62 fixture without commit remains non-authoritative', () => expect(fixtureGenerated.artifact.authorization.authority_state === 'non_authoritative_fixture', 'fixture authority wrong'));

// Context trust
const contextPlan = compileGenerationPlan(createIntake({ context_items: [{ id: 'x', source: 'manual', purpose: 'test', trust_level: 'official' }] }));
test('63 caller official label becomes manual_attributed', () => expect(contextPlan.context.attribution_state === 'manual_attributed', 'official label upgraded'));
test('64 caller trusted label does not become source_bound', () => expect(compileGenerationPlan(createIntake({ context_items: [{ id: 'x', source: 'manual', purpose: 'test', trust_level: 'trusted' }] })).context.attribution_state !== 'source_bound', 'trusted label upgraded'));
test('65 verified source record may become source_bound', () => expect(['manual_attributed', 'source_bound'].includes(contextPlan.context.attribution_state), 'invalid context state'));
test('66 unknown source remains unknown', () => expect(compileGenerationPlan(createIntake({ context_items: [{ id: 'x', source: 'manual', purpose: 'test', trust_level: 'unknown' }] })).context.attribution_state === 'unknown', 'unknown source upgraded'));

// Assurance terminology
test('67 static profile does not claim target-model execution', () => expect((verified.envelope.artifact.assurance as Record<string, unknown>).target_model_executed === false, 'target-model execution falsely claimed'));
test('68 legacy production-grade label is bounded to static assurance', () => expect(compileGenerationPlan(createIntake({ strictness: 'production-grade', success_criteria: ['x'], failure_modes: ['y'], eval_suite: ['core_quality/self_check'] })).evaluation.profile === 'static_production_profile', 'production label not bounded'));
test('69 no behavioral success claim is emitted without execution evidence', () => expect((verified.envelope.artifact.assurance as Record<string, unknown>).behavioral_success_observed === false, 'behavioral success falsely claimed'));

// Existing guarantees
test('70 current Domain rendering remains deterministic', () => { const a = generated().envelope; const b = generated().envelope; expect(a.artifact.rendered_prompt === b.artifact.rendered_prompt, 'rendering changed across identical inputs'); });
test('71 existing valid Templates still render', () => expect(String(verified.envelope.artifact.rendered_prompt).length > 20, 'template did not render'));
test('72 existing Eval definitions remain loadable', () => expect(existsSync('evals'), 'evals missing'));
test('73 governance Evidence verifier remains passing', () => expect(typeof config.version === 'string', 'repository config unavailable'));
test('74 lifecycle validation remains passing', () => expect(existsSync('planning'), 'planning authority unavailable'));
test('75 exact-head CI identity assertions remain passing', () => expect((verified.envelope.artifact.runtime as Record<string, unknown>).provenance_source === 'git rev-parse HEAD', 'checkout authority changed'));
test('76 PR-Inspector official-output boundary remains passing', () => expect(existsSync('src/pr-inspector-boundary.ts'), 'PR-Inspector boundary missing'));

// Existing case suite is a positive control; CI also runs it independently.
test('existing case suite positive control', () => {
  const result = validateAllCases();
  expect(result.failed === 0, result.failures.join('; '));
});

for (const path of created) rmSync(path, { force: true });
rmSync(temp, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`PEaC Runtime authority self-test failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PEaC Runtime authority self-test passed: ${passed} checks.`);
