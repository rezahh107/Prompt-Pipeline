#!/usr/bin/env tsx
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { evaluateConditionForTest, generateArtifact as generateLegacyArtifact, loadConfig, type Dict, type PEaCConfig } from '../src/peac.js';
import { compileRuntimePlan, createFixtureEnvelope, createValidatedIntakeEnvelope, generateArtifact as generateCanonicalArtifact } from '../src/runtime-authority-api.js';
import { validatorDefinitions } from '../src/runtime-authority-plan.js';
import { validateActiveDomainRoutes } from '../src/runtime-authority-route-schema.js';
import { resolveSubtypeDefinitionForTest } from '../src/runtime-authority-subtype.js';

let passed = 0;
const failures: string[] = [];
const generatedPaths: string[] = [];
function test(id: string, operation: () => void): void { try { operation(); passed += 1; } catch (error) { failures.push(`${id}: ${(error as Error).message}`); } }
function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function expectThrows(operation: () => void, contains: string): void { let message = ''; try { operation(); } catch (error) { message = (error as Error).message; } if (!message) throw new Error('expected an error'); if (!message.includes(contains)) throw new Error(`expected error containing ${contains}, got ${message}`); }
function record(value: unknown): Dict { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {}; }
function arrayOfRecords(value: unknown): Dict[] { return Array.isArray(value) ? value.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) as Dict[] : []; }
function intake(request: string, domainHint: string, domainInputs: Dict = {}, overrides: Dict = {}): Dict {
  return { request, desired_output: 'copy-ready prompt', target_environment: 'ChatGPT', strictness: 'precise', domain_hint: domainHint, domain_inputs: domainInputs, constraints: [], available_sources: [], requested_actions: [], sensitive_or_high_risk: false, uses_external_tools: false, legal_medical_financial: false, requires_current_information: false, exact_factual_claims: false, external_files: false, potential_downstream_execution: false, ...overrides };
}

const samples: Array<{ domain: string; subtype: string; raw: Dict }> = [
  { domain: 'prompt_generation', subtype: 'master_prompt', raw: intake('Create a reusable prompt for a friendly greeting.', 'prompt_generation') },
  { domain: 'prompt_audit', subtype: 'default', raw: intake('Audit prompt structure for risks.', 'prompt_audit', { prompt_to_audit: '[ROLE] Write a report.' }) },
  { domain: 'prompt_refactor', subtype: 'default', raw: intake('Improve prompt structure and constraints.', 'prompt_refactor', { original_prompt: 'Write a report.' }) },
  { domain: 'document_review', subtype: 'research_grounded_review', raw: intake('Review these documents and compare their evidence.', 'document_review') },
  { domain: 'repo_review', subtype: 'repository_audit', raw: intake('Please run a repository audit for this source tree.', 'repo_review', { review_subject: 'rezahh107/Prompt-Pipeline', review_scope: 'repository', objective: 'Produce an evidence-based audit.' }) },
  { domain: 'coding_debugging', subtype: 'code_review', raw: intake('Review code for correctness and tests.', 'coding_debugging', { task_kind: 'code_review', objective: 'Review the implementation.', stack: 'TypeScript and Node.js', review_artifact: 'src/runtime-authority-plan.ts' }) },
  { domain: 'image', subtype: 'image_generation', raw: intake('Create an image without a logo.', 'image', { image_type: 'portrait', subject_count: 0, has_source_photo: false, image_qa_requested: false }) },
  { domain: 'multimodal', subtype: 'image_prompt_design', raw: intake('Create an image prompt with exact text and logo fidelity.', 'multimodal') },
  { domain: 'ai_workflow_design', subtype: 'workflow_architecture', raw: intake('Design an AI workflow with tools, states, and evaluation.', 'ai_workflow_design') },
  { domain: 'general', subtype: 'default', raw: intake('Give me a practical decision framework.', 'general') },
];

const baseConfig = loadConfig();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'peac-phase-b-'));
const temporaryConfig: PEaCConfig = { ...baseConfig, domains_path: join(temporaryRoot, 'domains'), pipeline_path: join(temporaryRoot, 'pipeline'), policies_path: join(temporaryRoot, 'policies'), outputs_path: join(temporaryRoot, 'outputs'), artifact: { ...baseConfig.artifact, output_dir: join(temporaryRoot, 'outputs') } };
cpSync(baseConfig.domains_path, temporaryConfig.domains_path, { recursive: true });
cpSync(baseConfig.pipeline_path, temporaryConfig.pipeline_path, { recursive: true });
cpSync(baseConfig.policies_path, temporaryConfig.policies_path, { recursive: true });
const activeDomains = readdirSync(baseConfig.domains_path, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(baseConfig.domains_path, entry.name, 'route.yaml'))).map((entry) => entry.name).sort();
const sampledDomains = samples.map((sample) => sample.domain).sort();

test('SMOKE-MATRIX-COVERS-ALL-ACTIVE-DOMAINS', () => expect(JSON.stringify(activeDomains) === JSON.stringify(sampledDomains), `sampled Domains differ: active=${activeDomains.join(',')} sampled=${sampledDomains.join(',')}`));
test('ROUTE-SCHEMA-REPOSITORY-WIDE-PASS', () => { const result = validateActiveDomainRoutes(baseConfig); expect(result.diagnostics.length === 0, result.diagnostics.map((item) => `${item.code}:${item.message}`).join('; ')); expect(result.domains_checked === activeDomains.length, 'not all active Domain routes were checked'); });

for (const sample of samples) test(`CANONICAL-SMOKE-${sample.domain}`, () => {
  const envelope = createValidatedIntakeEnvelope(sample.raw, 'api_request', temporaryConfig);
  const assessment = compileRuntimePlan(envelope, temporaryConfig);
  expect(assessment.routing.domain === sample.domain, `expected ${sample.domain}, got ${assessment.routing.domain}`);
  expect(assessment.routing.subtype === sample.subtype, `expected ${sample.subtype}, got ${String(assessment.routing.subtype)}`);
  expect(assessment.contract.source_path.endsWith(join(sample.domain, 'input.contract.yaml')), 'contract source is not Domain-bound');
  expect(assessment.rules.applicable.every((rule) => rule.execution_result === 'applied'), 'applicable Domain rule did not execute');
  const generated = generateCanonicalArtifact(envelope, 'ci', temporaryConfig);
  generatedPaths.push(generated.outputPath);
  const payload = generated.artifact.artifact as Dict;
  const derived = record(payload.derived_projection);
  const plan = record(derived.generationPlan);
  const routing = record(derived.routing);
  const contract = record(plan.contract);
  const resolvedInputs = record(contract.resolved_inputs);
  const ledger = arrayOfRecords(derived.validationLedger);
  const identity = record(payload.canonical_prompt_identity);
  const provenance = record(payload.provenance);
  expect(String(routing.domain) === sample.domain, 'artifact routing Domain differs from canonical plan');
  expect(String(routing.subtype) === sample.subtype, 'artifact routing Subtype differs from canonical plan');
  expect(String(contract.source_path) === assessment.contract.source_path, 'artifact contract source differs from canonical plan');
  expect(resolve(String(identity.templatePath)) === resolve(String(provenance.template_used)), 'artifact template provenance differs from canonical identity');
  for (const definition of validatorDefinitions(temporaryConfig, sample.domain).checks) {
    const validatorId = String(definition.id ?? 'unnamed_check');
    const observed = ledger.find((item) => String(item.check_id ?? '') === validatorId);
    expect(observed, `validator ledger record missing: ${sample.domain}.${validatorId}`);
    const expectedApplicable = definition.applies_when === undefined || evaluateConditionForTest(String(definition.applies_when), resolvedInputs);
    expect(observed.applicable === expectedApplicable, `validator applicability differs: ${sample.domain}.${validatorId}`);
    expect(expectedApplicable ? observed.executed === true : observed.executed === false, `validator execution state differs: ${sample.domain}.${validatorId}`);
  }
});

test('NEGATIVE-CONTRACT-FIXTURE', () => {
  const raw = intake('Please run a repository audit for this source tree.', 'repo_review', { review_subject: 'rezahh107/Prompt-Pipeline', review_scope: 'repository' });
  expectThrows(() => compileRuntimePlan(createValidatedIntakeEnvelope(raw, 'api_request', temporaryConfig), temporaryConfig), 'objective: required');
});
test('ROUTING-BOUNDARY-FIXTURE', () => {
  const raw = intake('Please run a repository audit for this source tree.', 'prompt_generation', { review_subject: 'rezahh107/Prompt-Pipeline', review_scope: 'repository', objective: 'Audit repository evidence.' });
  const plan = compileRuntimePlan(createValidatedIntakeEnvelope(raw, 'api_request', temporaryConfig), temporaryConfig);
  expect(plan.routing.domain === 'repo_review', 'domain_hint overrode strong repository-audit routing evidence');
  expect(plan.routing.hint_conflict === true, 'routing boundary did not record hint conflict');
});
test('SUBTYPE-AMBIGUITY-FIXTURE', () => expectThrows(() => resolveSubtypeDefinitionForTest({ subtypes: [{ id: 'one', triggers: ['flag == true'], templates: { primary: 'one.j2' } }, { id: 'two', triggers: ['flag == true'], templates: { primary: 'two.j2' } }] }, { flag: true }), 'Multiple matching Subtypes'));

test('DECLARED-FIXTURE-DOMAIN-IS-NON-AUTHORITATIVE', () => {
  const fixturePath = 'domains/prompt_generation/cases/master-prompt-basic.yaml';
  const result = generateCanonicalArtifact(createFixtureEnvelope(fixturePath), 'ci');
  generatedPaths.push(result.outputPath);
  const payload = result.artifact.artifact as Dict;
  const routing = record(record(payload.derived_projection).routing);
  expect(payload.domain === 'prompt_generation', `fixture description overrode declared Domain: ${String(payload.domain)}`);
  expect(routing.method === 'fixture_declared_non_authoritative', 'fixture route was not explicitly marked non-authoritative');
  expect(result.artifact.authorization.authority_state === 'non_authoritative_fixture', 'fixture gained authority');
  expect(result.artifact.authorization.downstream_use_allowed === false, 'fixture allowed downstream use');
});

test('WARNING-COMBINATION-REMAINS-NONBLOCKING', () => {
  const fixturePath = 'domains/repo_review/cases/irreversible-action-warning.yaml';
  const result = generateCanonicalArtifact(createFixtureEnvelope(fixturePath), 'ci');
  generatedPaths.push(result.outputPath);
  const payload = result.artifact.artifact as Dict;
  const ledger = arrayOfRecords(record(payload.derived_projection).validationLedger);
  const warning = ledger.find((item) => String(item.check_id ?? '') === 'forbidden_combinations_clear');
  expect(warning?.applicable === true && warning.executed === true, 'warning validator did not execute');
  expect(warning?.blocking === false && warning.passed === false, 'warning-level combination was not preserved as nonblocking evidence');
  expect(result.artifact.authorization.authority_state === 'non_authoritative_fixture', 'warning fixture gained authority');
});

function mutateRoute(domain: string, mutation: (route: Dict) => void): ReturnType<typeof validateActiveDomainRoutes> {
  const routePath = join(temporaryConfig.domains_path, domain, 'route.yaml');
  const original = readFileSync(routePath, 'utf8');
  const route = (yaml.load(original) ?? {}) as Dict;
  mutation(route);
  writeFileSync(routePath, yaml.dump(route, { lineWidth: 120, noRefs: true }));
  try { return validateActiveDomainRoutes(temporaryConfig); } finally { writeFileSync(routePath, original); }
}
test('ROUTE-SCHEMA-DUPLICATE-ID-FAILS', () => { const result = mutateRoute('repo_review', (route) => { const subtypes = route.subtypes as Dict[]; subtypes[1].id = subtypes[0].id; }); expect(result.diagnostics.some((item) => item.code === 'ROUTE_SUBTYPE_ID_DUPLICATE'), 'duplicate Subtype ID was not rejected'); });
test('ROUTE-SCHEMA-UNKNOWN-TRIGGER-FIELD-FAILS', () => { const result = mutateRoute('repo_review', (route) => { const subtypes = route.subtypes as Dict[]; subtypes[0].triggers = ['unknown_contract_field == true']; }); expect(result.diagnostics.some((item) => item.code === 'ROUTE_TRIGGER_UNKNOWN_FIELD'), 'unknown trigger field was not rejected'); });
test('ROUTE-SCHEMA-EMPTY-TRIGGER-FAILS', () => { const result = mutateRoute('repo_review', (route) => { const subtypes = route.subtypes as Dict[]; subtypes[0].triggers = []; }); expect(result.diagnostics.some((item) => item.code === 'ROUTE_EMPTY_TRIGGER'), 'empty trigger ambiguity was not rejected'); });
test('ROUTE-SCHEMA-MULTIPLE-DEFAULTS-FAILS', () => { const result = mutateRoute('repo_review', (route) => { const subtypes = route.subtypes as Dict[]; subtypes[0].is_default = true; subtypes[1].is_default = true; }); expect(result.diagnostics.some((item) => item.code === 'ROUTE_MULTIPLE_DEFAULTS'), 'multiple defaults were not rejected'); });
test('ROUTE-SCHEMA-MISSING-TEMPLATE-FAILS', () => { const result = mutateRoute('repo_review', (route) => { const subtypes = route.subtypes as Dict[]; subtypes[0].templates = { primary: 'missing-template.j2' }; }); expect(result.diagnostics.some((item) => item.code === 'ROUTE_TEMPLATE_MISSING'), 'missing template was not rejected'); });

test('CANONICAL-VERSUS-LEGACY-COMPATIBILITY-FIXTURE', () => {
  const casePath = 'domains/repo_review/cases/repository-audit-basic.yaml';
  const canonical = generateCanonicalArtifact(createFixtureEnvelope(casePath), 'ci');
  const legacy = generateLegacyArtifact({ case: casePath, mode: 'ci' });
  generatedPaths.push(canonical.outputPath, legacy.outputPath);
  const payload = canonical.artifact.artifact as Dict;
  expect(payload.domain === legacy.artifact.domain, 'legacy Domain differs from canonical Domain');
  expect(payload.subtype === legacy.artifact.subtype, 'legacy Subtype differs from canonical Subtype');
  expect(String(payload.rendered_prompt) === legacy.artifact.rendered_prompt, 'legacy rendered prompt differs from canonical rendered prompt');
  expect(basename(String(record(payload.canonical_prompt_identity).templatePath)) === basename(legacy.artifact.provenance.template_used), 'legacy template differs from canonical template');
  expect(canonical.artifact.authorization.authority_state === 'non_authoritative_fixture', 'compatibility fixture gained authority');
});

for (const path of generatedPaths) rmSync(path, { force: true });
rmSync(temporaryRoot, { recursive: true, force: true });
if (failures.length > 0) { console.error(`Canonical test/eval parity tests failed: ${failures.length}`); for (const failure of failures) console.error(`- ${failure}`); process.exit(1); }
console.log(`Canonical test/eval parity tests passed: ${passed}.`);
