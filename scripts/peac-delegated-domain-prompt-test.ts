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
  verifyArtifact,
  sha256Json,
} from '../src/runtime-authority-api.js';
import { delegatedTargetFromPlan } from '../src/runtime-authority-delegation.js';

let passed = 0;
const failures: string[] = [];
const generatedPaths: string[] = [];
function test(id: string, operation: () => void): void { try { operation(); passed += 1; } catch (error) { failures.push(`${id}: ${(error as Error).message}`); } }
function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function expectThrows(operation: () => void, contains: string): void { let message = ''; try { operation(); } catch (error) { message = (error as Error).message; } if (!message) throw new Error('expected an error'); if (!message.includes(contains)) throw new Error(`expected error containing ${contains}, got ${message}`); }
function record(value: unknown): Dict { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {}; }
function records(value: unknown): Dict[] { return Array.isArray(value) ? value.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) as Dict[] : []; }
function riskRank(value: unknown): number { const risk = String(value); if (risk === 'clarification_required' || risk === 'unknown') return 5; if (risk === 'high') return 4; if (risk === 'medium') return 3; return 1; }

function intake(request: string, overrides: Dict = {}): Dict {
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

const repositoryTargetInputs: Dict = {
  review_subject: 'rezahh107/Prompt-Pipeline',
  review_scope: 'repository',
  objective: 'Produce an evidence-based repository audit prompt.',
};

const baseConfig = loadConfig();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'peac-phase-c-'));
const config: PEaCConfig = {
  ...baseConfig,
  domains_path: join(temporaryRoot, 'domains'),
  pipeline_path: join(temporaryRoot, 'pipeline'),
  policies_path: join(temporaryRoot, 'policies'),
  outputs_path: join(temporaryRoot, 'outputs'),
  artifact: { ...baseConfig.artifact, schema: join(temporaryRoot, 'pipeline', 'artifact.schema.json'), output_dir: join(temporaryRoot, 'outputs') },
};
cpSync(baseConfig.domains_path, config.domains_path, { recursive: true });
cpSync(baseConfig.pipeline_path, config.pipeline_path, { recursive: true });
cpSync(baseConfig.policies_path, config.policies_path, { recursive: true });

function compile(raw: Dict) {
  return compileRuntimePlan(createValidatedIntakeEnvelope(raw, 'api_request', config), config);
}

let delegatedOutput = '';
let delegatedArtifact: Dict | null = null;

test('C-DIRECT-REPOSITORY-AUDIT-REMAINS-DIRECT', () => {
  const raw = intake('Audit this repository.', { domain_inputs: repositoryTargetInputs });
  const plan = compile(raw);
  expect(plan.routing.domain === 'repo_review', `expected direct repo_review, got ${plan.routing.domain}`);
  expect(plan.routing.subtype === 'repository_audit', `expected direct repository_audit, got ${String(plan.routing.subtype)}`);
  expect((plan.generationPlan as unknown as Dict).plan_version === 'generation-plan.v2', 'direct request did not retain Generation Plan v2');
  expect(delegatedTargetFromPlan(plan) === null, 'direct repository audit created a delegated target');
  const generated = generateArtifact(createValidatedIntakeEnvelope(raw, 'api_request', config), 'ci', config);
  generatedPaths.push(generated.outputPath);
  expect((generated.artifact as unknown as Dict).schema_version === 'runtime-artifact-envelope.v1', 'direct request did not retain Runtime Artifact v1');
  const payload = generated.artifact.artifact as unknown as Dict;
  expect(!Object.prototype.hasOwnProperty.call(payload, 'delegation_provenance'), 'direct v1 artifact gained delegation provenance');
  expect(verifyArtifact(generated.outputPath, config).verification_status === 'verified', 'direct v1 artifact is no longer verifiable');
});

test('C-DELEGATED-REPOSITORY-AUDIT-PLAN', () => {
  const raw = intake('Create a prompt for repository audit.', { target_inputs: repositoryTargetInputs });
  const plan = compile(raw);
  const target = delegatedTargetFromPlan(plan);
  expect(plan.routing.domain === 'prompt_generation', `expected outer prompt_generation, got ${plan.routing.domain}`);
  expect(plan.routing.subtype === 'delegated_domain_prompt', `expected delegated_domain_prompt, got ${String(plan.routing.subtype)}`);
  expect((plan.generationPlan as unknown as Dict).plan_version === 'generation-plan.v3', 'delegated plan did not emit Generation Plan v3');
  expect(target, 'DelegatedTargetPlan is missing');
  const targetRouting = record(target.routing);
  const targetContract = record(target.contract);
  const targetRules = record(target.rules);
  const targetTemplate = record(target.template);
  expect(targetRouting.domain === 'repo_review', `expected target repo_review, got ${String(targetRouting.domain)}`);
  expect(target.subtype === 'repository_audit', `expected target repository_audit, got ${String(target.subtype)}`);
  expect(String(targetContract.source_path).endsWith(join('repo_review', 'input.contract.yaml')), 'target contract is not the actual repo_review contract');
  expect(record(targetContract.resolved_inputs).review_scope === 'repository', 'target contract inputs were not resolved');
  expect(records(targetRules.applied).length > 0, 'target rules were not applied');
  expect(records(targetRules.applied).every((rule) => String(rule.rule_id).startsWith('target:repo_review:')), 'target rules are not namespaced');
  expect(String(targetTemplate.path).endsWith(join('repo_review', 'templates', 'repository-audit.j2')), 'target template is not repository-audit.j2');
  expect(riskRank(plan.risk.classification) >= riskRank(record(target.risk).classification), 'final risk is lower than target risk');
  expect(plan.risk.review_required || record(target.risk).review_required !== true, 'target review requirement did not propagate');
  for (const forbidden of ['artifact', 'authority_state', 'publication', 'review_receipt', 'review_state']) expect(!Object.prototype.hasOwnProperty.call(target, forbidden), `target plan contains forbidden field ${forbidden}`);
});

test('C-DELEGATED-ARTIFACT-AND-VALIDATORS', () => {
  const raw = intake('Create a prompt for repository audit.', { target_inputs: repositoryTargetInputs });
  const generated = generateArtifact(createValidatedIntakeEnvelope(raw, 'api_request', config), 'ci', config);
  generatedPaths.push(generated.outputPath);
  delegatedOutput = generated.outputPath;
  delegatedArtifact = generated.artifact as unknown as Dict;
  expect(delegatedArtifact.schema_version === 'runtime-artifact-envelope.v2', 'delegated request did not emit Runtime Artifact v2');
  const payload = record(delegatedArtifact.artifact);
  const identity = record(payload.canonical_prompt_identity);
  const provenance = record(payload.delegation_provenance);
  const target = record(provenance.target);
  const targetRouting = record(target.routing);
  const ledger = records(record(payload.validation_ledger).checks);
  expect(identity.domain === 'prompt_generation', 'canonical identity outer Domain changed');
  expect(identity.subtype === 'delegated_domain_prompt', 'canonical identity outer Subtype changed');
  expect(String(identity.templatePath).endsWith(join('repo_review', 'templates', 'repository-audit.j2')), 'canonical final template is not target template');
  expect(targetRouting.domain === 'repo_review' && target.subtype === 'repository_audit', 'delegation provenance target owner is wrong');
  expect(String(payload.rendered_prompt).includes('Senior Software Architect, Repository Auditor'), 'final artifact was not rendered from repository-audit template');
  expect(String(payload.rendered_prompt).includes('[DELEGATION PROVENANCE]'), 'bounded outer delegation provenance was not appended');
  expect(String(payload.rendered_prompt).includes('[NON-EXECUTION BOUNDARY]'), 'non-execution boundary is missing');
  const validatorIds = [
    'target:repo_review:required_fields_complete',
    'target:repo_review:evidence_rules_present',
    'target:repo_review:no_fake_results_rule_present',
  ];
  for (const id of validatorIds) {
    const check = ledger.find((item) => item.check_id === id);
    expect(check?.applicable === true && check.executed === true && check.passed === true, `target validator did not pass: ${id}`);
  }
  const riskCheck = ledger.find((item) => item.check_id === 'target:repo_review:risk_known');
  expect(riskCheck?.passed === true && riskCheck.blocking === true, 'target risk-known gate did not pass');
  expect(verifyArtifact(generated.outputPath, config).verification_status === 'verified', 'delegated Runtime Artifact v2 did not verify');
});

test('C-EXPLICIT-TARGET-REQUEST-WHEN-WRAPPER-UNAVAILABLE', () => {
  const plan = compile(intake('Design a reusable prompt specification.', {
    target_request: 'repository audit',
    target_inputs: repositoryTargetInputs,
  }));
  const target = delegatedTargetFromPlan(plan);
  expect(plan.routing.domain === 'prompt_generation', 'explicit target request lost outer prompt_generation route');
  expect(target?.derivation_method === 'explicit_target_request', 'explicit target derivation was not recorded');
  expect(record(target?.routing).domain === 'repo_review', 'explicit target did not resolve through canonical router');
});

test('C-GENERIC-PROMPT-REMAINS-MASTER', () => {
  const plan = compile(intake('Create a prompt for a friendly greeting.'));
  expect(plan.routing.domain === 'prompt_generation', 'generic prompt request lost prompt_generation route');
  expect(plan.routing.subtype === 'master_prompt', 'generic prompt request did not remain master_prompt');
  expect(delegatedTargetFromPlan(plan) === null, 'generic prompt request created a specialized target');
  expect((plan.generationPlan as unknown as Dict).plan_version === 'generation-plan.v2', 'generic prompt request migrated to v3 without delegation');
});

test('C-MISSING-TARGET-CONTRACT-INPUTS-FAIL', () => {
  expectThrows(() => compile(intake('Create a prompt for repository audit.')), 'Delegated target contract validation failed');
});

test('C-EXPLICIT-AND-EXTRACTED-TARGET-CONFLICT-FAIL', () => {
  expectThrows(() => compile(intake('Create a prompt for repository audit.', {
    target_request: 'code review',
    target_inputs: repositoryTargetInputs,
  })), 'conflicts with the target task extracted');
});

test('C-RECURSIVE-TARGET-FAIL', () => {
  expectThrows(() => compile(intake('Create a prompt for create a prompt for repository audit.', {
    target_inputs: repositoryTargetInputs,
  })), 'cannot recursively request another prompt-generation route');
});

test('C-RESERVED-TARGET-AUTHORITY-FIELD-FAIL', () => {
  expectThrows(() => compile(intake('Create a prompt for repository audit.', {
    target_inputs: { ...repositoryTargetInputs, risk_level: 'high' },
  })), 'cannot override reserved authority field');
});

test('C-TARGET-FIELDS-REJECTED-ON-DIRECT-ROUTE', () => {
  expectThrows(() => compile(intake('Audit this repository.', {
    domain_inputs: repositoryTargetInputs,
    target_request: 'repository audit',
    target_inputs: repositoryTargetInputs,
  })), 'valid only when canonical outer routing selects prompt_generation');
});

test('C-UNRESOLVED-EXPLICIT-TARGET-FAIL', () => {
  expectThrows(() => compile(intake('Design a reusable prompt specification.', {
    target_request: 'something entirely unspecified',
  })), 'did not resolve to a specialized target Domain');
});

test('C-TEMPLATE-PROVENANCE-MUTATION-REJECTED', () => {
  expect(delegatedOutput && delegatedArtifact, 'delegated artifact prerequisite is missing');
  const tamperedPath = join(temporaryRoot, 'tampered-delegated.yaml');
  const tampered = yaml.load(readFileSync(delegatedOutput, 'utf8')) as Dict;
  const payload = record(tampered.artifact);
  const provenance = record(payload.delegation_provenance);
  const target = record(provenance.target);
  const template = record(target.template);
  template.path = join(config.domains_path, 'repo_review', 'templates', 'mutated-template.j2');
  tampered.artifact_sha256 = sha256Json(payload);
  const { envelope_sha256: _old, ...withoutEnvelopeDigest } = tampered;
  tampered.envelope_sha256 = sha256Json(withoutEnvelopeDigest);
  writeFileSync(tamperedPath, yaml.dump(tampered, { lineWidth: 120, noRefs: true }));
  const verified = verifyArtifact(tamperedPath, config);
  expect(verified.verification_status === 'rejected', 'target template provenance mutation was not rejected');
  rmSync(tamperedPath, { force: true });
});

for (const path of generatedPaths) rmSync(path, { force: true });
rmSync(temporaryRoot, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`Delegated domain prompt tests failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Delegated domain prompt tests passed: ${passed}.`);
