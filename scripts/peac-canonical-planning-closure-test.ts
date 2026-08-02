#!/usr/bin/env tsx
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { loadConfig, type Dict, type PEaCConfig } from '../src/peac.js';
import {
  compileRuntimePlan,
  createFixtureEnvelope,
  createValidatedIntakeEnvelope,
  generateArtifact,
} from '../src/runtime-authority-api.js';
import { validatorDefinitions } from '../src/runtime-authority-plan.js';
import { resolveSubtypeDefinitionForTest } from '../src/runtime-authority-subtype.js';
import { planCanonicalIntake } from './peac-intake.js';

let passed = 0;
const failures: string[] = [];
const createdPaths: string[] = [];

function test(id: string, operation: () => void): void {
  try {
    operation();
    passed += 1;
  } catch (error) {
    failures.push(`${id}: ${(error as Error).message}`);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrows(operation: () => void, contains: string): void {
  let message = '';
  try {
    operation();
  } catch (error) {
    message = (error as Error).message;
  }
  if (!message) throw new Error('expected an error');
  if (!message.includes(contains)) throw new Error(`expected error containing ${contains}, got ${message}`);
}

function intake(
  request: string,
  expectedDomain: string,
  domainInputs: Dict = {},
  overrides: Dict = {},
): Dict {
  return {
    request,
    desired_output: 'copy-ready prompt',
    target_environment: 'ChatGPT',
    strictness: 'precise',
    domain_hint: expectedDomain,
    domain_inputs: domainInputs,
    constraints: [],
    available_sources: [],
    requested_actions: [],
    sensitive_or_high_risk: false,
    uses_external_tools: false,
    legal_medical_financial: false,
    requires_current_information: false,
    exact_factual_claims: false,
    external_files: false,
    potential_downstream_execution: false,
    ...overrides,
  };
}

const samples: Array<{ domain: string; subtype: string; raw: Dict }> = [
  {
    domain: 'prompt_generation',
    subtype: 'master_prompt',
    raw: intake('Create a reusable prompt for a friendly greeting.', 'prompt_generation'),
  },
  {
    domain: 'prompt_audit',
    subtype: 'default',
    raw: intake('Audit prompt structure for risks.', 'prompt_audit', { prompt_to_audit: '[ROLE] Write a report.' }),
  },
  {
    domain: 'prompt_refactor',
    subtype: 'default',
    raw: intake('Improve prompt structure and constraints.', 'prompt_refactor', { original_prompt: 'Write a report.' }),
  },
  {
    domain: 'document_review',
    subtype: 'research_grounded_review',
    raw: intake('Review these documents and compare their evidence.', 'document_review'),
  },
  {
    domain: 'repo_review',
    subtype: 'repository_audit',
    raw: intake('Please run a repository audit for this source tree.', 'repo_review', {
      review_subject: 'rezahh107/Prompt-Pipeline',
      review_scope: 'repository',
      objective: 'Produce an evidence-based audit.',
    }),
  },
  {
    domain: 'coding_debugging',
    subtype: 'code_review',
    raw: intake('Review code for correctness and tests.', 'coding_debugging', {
      task_kind: 'code_review',
      objective: 'Review the implementation.',
      stack: 'TypeScript and Node.js',
      review_artifact: 'src/runtime-authority-plan.ts',
    }),
  },
  {
    domain: 'image',
    subtype: 'image_generation',
    raw: intake('Create an image without a logo.', 'image', {
      image_type: 'portrait',
      subject_count: 0,
      has_source_photo: false,
      image_qa_requested: false,
    }),
  },
  {
    domain: 'multimodal',
    subtype: 'image_prompt_design',
    raw: intake('Create an image prompt with exact text and logo fidelity.', 'multimodal'),
  },
  {
    domain: 'ai_workflow_design',
    subtype: 'workflow_architecture',
    raw: intake('Design an AI workflow with tools, states, and evaluation.', 'ai_workflow_design'),
  },
  {
    domain: 'general',
    subtype: 'default',
    raw: intake('Give me a practical decision framework.', 'general'),
  },
];

for (const sample of samples) test(`SMOKE-${sample.domain}`, () => {
  const plan = compileRuntimePlan(createValidatedIntakeEnvelope(sample.raw, 'api_request'));
  expect(plan.routing.domain === sample.domain, `expected Domain ${sample.domain}, got ${plan.routing.domain}`);
  expect(plan.routing.subtype === sample.subtype, `expected Subtype ${sample.subtype}, got ${String(plan.routing.subtype)}`);
  expect(plan.contract.resolved_inputs.subtype === sample.subtype, 'resolved contract input did not contain canonical Subtype');
  expect(plan.governingSources.some((source) => source.path.includes('/templates/') || source.path.includes('\\templates\\')), 'template source was not discovered');
  expect(plan.requiredChecks.some((check) => check.check_id === 'domain_contract'), 'canonical domain contract Check missing');
  const validatorIds = validatorDefinitions(loadConfig(), sample.domain).checks.map((check) => String(check.id ?? 'unnamed_check'));
  expect(validatorIds.length > 0, `no Domain validators discovered for ${sample.domain}`);
  for (const validatorId of validatorIds) expect(plan.requiredChecks.some((check) => check.check_id === validatorId), `validator Check missing: ${sample.domain}.${validatorId}`);
});

test('SUBTYPE-INVALID-REQUESTED', () => {
  expectThrows(() => resolveSubtypeDefinitionForTest({ subtypes: [{ id: 'known', is_default: true }] }, {}, 'unknown'), 'does not exist');
});

test('SUBTYPE-MULTIPLE-MATCHES', () => {
  expectThrows(() => resolveSubtypeDefinitionForTest({
    subtypes: [
      { id: 'one', triggers: ['flag == true'] },
      { id: 'two', triggers: ['flag == true'] },
    ],
  }, { flag: true }), 'Multiple matching Subtypes');
});

test('SUBTYPE-ZERO-WITHOUT-DEFAULT', () => {
  expectThrows(() => resolveSubtypeDefinitionForTest({ subtypes: [{ id: 'one', triggers: ['flag == true'] }] }, { flag: false }), 'explicit default');
});

test('SUBTYPE-EMPTY-TRIGGER-DOES-NOT-MATCH', () => {
  const result = resolveSubtypeDefinitionForTest({
    subtypes: [
      { id: 'empty', triggers: [] },
      { id: 'default', is_default: true },
    ],
  }, {});
  expect(result.subtype === 'default' && result.method === 'default', 'empty trigger list acted as a match');
});

test('IMAGE-INFERENCE-BEFORE-RISK', () => {
  const raw = intake('Edit this source portrait while preserving identity.', 'image', {
    image_type: 'portrait',
    subject_count: 1,
    has_source_photo: true,
    image_qa_requested: false,
  });
  const plan = compileRuntimePlan(createValidatedIntakeEnvelope(raw, 'api_request'));
  expect(plan.routing.subtype === 'identity_preserving_edit', 'image identity Subtype was not selected');
  expect(plan.contract.resolved_inputs.subject_identity === true, 'subject_identity inference was not applied canonically');
});

test('DOMAIN-INPUT-UNKNOWN-FAILS', () => {
  expectThrows(() => compileRuntimePlan(createValidatedIntakeEnvelope(intake(
    'Please run a repository audit for this source tree.',
    'repo_review',
    { review_subject: 'repo', review_scope: 'repository', objective: 'audit', unknown_field: true },
  ), 'api_request')), 'Unknown domain_inputs field');
});

test('DOMAIN-INPUT-RESERVED-FAILS', () => {
  expectThrows(() => compileRuntimePlan(createValidatedIntakeEnvelope(intake(
    'Please run a repository audit for this source tree.',
    'repo_review',
    { review_subject: 'repo', review_scope: 'repository', objective: 'audit', subtype: 'pr_critique' },
  ), 'api_request')), 'reserved authority field');
});

test('DOMAIN-HINT-CANNOT-OVERRIDE-STRONG-ROUTE', () => {
  const raw = intake(
    'Please run a repository audit for this source tree.',
    'prompt_generation',
    { review_subject: 'repo', review_scope: 'repository', objective: 'audit' },
  );
  const plan = compileRuntimePlan(createValidatedIntakeEnvelope(raw, 'api_request'));
  expect(plan.routing.domain === 'repo_review', `conflicting hint overrode Runtime route: ${plan.routing.domain}`);
  expect(plan.routing.hint_conflict === true, 'hint conflict was not recorded');
});

const baseConfig = loadConfig();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'peac-planning-closure-'));
const copiedDomains = join(temporaryRoot, 'domains');
const copiedPipeline = join(temporaryRoot, 'pipeline');
const copiedPolicies = join(temporaryRoot, 'policies');
cpSync(baseConfig.domains_path, copiedDomains, { recursive: true });
cpSync(baseConfig.pipeline_path, copiedPipeline, { recursive: true });
cpSync(baseConfig.policies_path, copiedPolicies, { recursive: true });
const temporaryConfig: PEaCConfig = {
  ...baseConfig,
  domains_path: copiedDomains,
  pipeline_path: copiedPipeline,
  policies_path: copiedPolicies,
  outputs_path: join(temporaryRoot, 'outputs'),
  artifact: { ...baseConfig.artifact, output_dir: join(temporaryRoot, 'outputs') },
};

test('RULE-CARRIER-MISSING-FAILS-CLOSED', () => {
  const path = join(copiedDomains, 'document_review', 'rules.yaml');
  const source = yaml.load(readFileSync(path, 'utf8')) as { rules?: Dict[] };
  if (!source.rules?.[0]) throw new Error('document_review rule fixture unavailable');
  delete source.rules[0].rule;
  writeFileSync(path, yaml.dump(source, { lineWidth: 120, noRefs: true }));
  expectThrows(() => compileRuntimePlan(createValidatedIntakeEnvelope(samples.find((item) => item.domain === 'document_review')?.raw ?? {}, 'api_request', temporaryConfig), temporaryConfig), 'Applicable rule without executable carrier');
});

test('CANONICAL-AND-RENDERED-IDENTITY-MATCH', () => {
  const raw = samples.find((item) => item.domain === 'general')?.raw;
  if (!raw) throw new Error('general smoke input unavailable');
  const result = generateArtifact(createValidatedIntakeEnvelope(raw, 'api_request', temporaryConfig), 'ci', temporaryConfig);
  createdPaths.push(result.outputPath);
  const artifact = result.artifact.artifact;
  const identity = artifact.canonical_prompt_identity as Dict;
  const provenance = artifact.provenance as Dict;
  expect(artifact.domain === identity.domain, 'rendered Domain differs from canonical identity');
  expect(artifact.subtype === identity.subtype, 'rendered Subtype differs from canonical identity');
  expect(String(provenance.template_used) === String(identity.templatePath), 'rendered template differs from canonical identity');
});

test('LEGACY-INTAKE-ADAPTER-PARITY', () => {
  const raw = samples.find((item) => item.domain === 'repo_review')?.raw;
  if (!raw) throw new Error('repo_review smoke input unavailable');
  const canonical = compileRuntimePlan(createValidatedIntakeEnvelope(raw, 'api_request'));
  const adapter = planCanonicalIntake(raw);
  expect(adapter.routing.domain === canonical.routing.domain, 'legacy intake adapter Domain differs');
  expect(adapter.routing.subtype === canonical.routing.subtype, 'legacy intake adapter Subtype differs');
  expect(adapter.contract.source_sha256 === canonical.contract.source_sha256, 'legacy intake adapter contract differs');
});

test('FIXTURE-REMAINS-NON-AUTHORITATIVE', () => {
  const fixturePath = join(temporaryRoot, 'general.case.yaml');
  mkdirSync(temporaryRoot, { recursive: true });
  writeFileSync(fixturePath, yaml.dump({
    case_id: 'planning-closure.fixture',
    domain: 'general',
    subtype: 'default',
    inputs: { task: 'Create a generic prompt.', output_format: 'text' },
  }, { lineWidth: 120, noRefs: true }));
  const result = generateArtifact(createFixtureEnvelope(fixturePath, temporaryConfig), 'ci', temporaryConfig);
  createdPaths.push(result.outputPath);
  expect(result.artifact.authorization.authority_state === 'non_authoritative_fixture', 'fixture gained publication authority');
  expect(result.artifact.authorization.downstream_use_allowed === false, 'fixture allowed downstream use');
});

for (const path of createdPaths) rmSync(path, { force: true });
rmSync(temporaryRoot, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`Canonical planning closure tests failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Canonical planning closure tests passed: ${passed}.`);
