import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import {
  evaluateConditionForTest,
  generateArtifact as generateLegacyFixtureArtifact,
  readYamlFile,
  type Dict,
  type ExecutionMode,
  type PEaCConfig,
} from './peac.js';
import {
  type ArtifactReviewReceipt,
  type AuthorityDecision,
  type CheckoutIdentity,
  type CompletedRuntimeAssessment,
  type CompletionIntegrity,
  type DomainContract,
  type DomainValidator,
  type LegacyValidationProjection,
  type NonEmptyValidationLedger,
  type RuntimePlanAssessment,
  type ValidationCheckRecord,
  canonicalJson,
  sha256File,
  sha256Json,
  validatedPlans,
  validatedRuntimePlans,
} from './runtime-authority-foundation.js';
import { active, resolveAndValidateContract, validatorDefinitions } from './runtime-authority-plan.js';

function assertRuntimePlan(plan: RuntimePlanAssessment): void {
  if (!validatedRuntimePlans.has(plan)) throw new Error('RuntimePlanAssessment must be compiled by compileRuntimePlan in this process.');
  if (!validatedPlans.has(plan.generationPlan)) throw new Error('GenerationPlan must be compiled by the Runtime.');
  if (sha256Json(plan.generationPlan.intake.normalized_inputs) !== plan.generationPlan.intake.digest) throw new Error('Generation plan intake digest mismatch.');
  if (plan.generationPlan.plan_id !== 'peac.validated-generation-plan' || plan.generationPlan.plan_version !== 'generation-plan.v2') throw new Error('Runtime plan identity is invalid.');
}

export function currentCheckoutIdentity(): CheckoutIdentity {
  let actual: string | null = null;
  try {
    actual = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase() || null;
  } catch {
    actual = null;
  }
  const value = process.env.EXPECTED_TESTED_SHA ?? process.env.GITHUB_SHA ?? null;
  const expected = value && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null;
  return { actual_sha: actual, expected_sha: expected, source: 'git rev-parse HEAD' };
}

function absoluteConfig(config: PEaCConfig, outputPath: string): PEaCConfig {
  return {
    ...config,
    kb_path: resolve(config.kb_path),
    policies_path: resolve(config.policies_path),
    domains_path: resolve(config.domains_path),
    pipeline_path: resolve(config.pipeline_path),
    outputs_path: outputPath,
    artifact: { ...config.artifact, schema: resolve(config.artifact.schema), output_dir: outputPath },
  };
}

export function renderThroughStagedLegacy(plan: RuntimePlanAssessment, mode: ExecutionMode, config: PEaCConfig): Dict {
  assertRuntimePlan(plan);
  const generationPlan = plan.generationPlan;
  const stagingRoot = resolve(config.outputs_path, '.runtime-staging');
  mkdirSync(stagingRoot, { recursive: true });
  const workspace = mkdtempSync(join(stagingRoot, 'render-'));
  const outputDir = join(workspace, 'legacy-output');
  mkdirSync(outputDir, { recursive: true });
  const casePath = join(workspace, 'canonical.case.yaml');
  writeFileSync(casePath, yaml.dump({
    case_id: `runtime.${generationPlan.routing.domain}.${randomUUID()}`,
    description: String(generationPlan.intake.normalized_inputs.request ?? ''),
    domain: generationPlan.routing.domain,
    subtype: generationPlan.routing.subtype ?? undefined,
    version: config.version ?? 'dev',
    inputs: generationPlan.contract.resolved_inputs,
    expected: { validation: { should_pass: true } },
  }, { lineWidth: 120, noRefs: true }));
  const runtimeConfig = absoluteConfig(config, outputDir);
  writeFileSync(join(workspace, 'peac.config.yaml'), yaml.dump(runtimeConfig, { lineWidth: 120, noRefs: true }));
  const previousCwd = process.cwd();
  try {
    process.chdir(workspace);
    const result = generateLegacyFixtureArtifact({ case: casePath, mode });
    return result.artifact as unknown as Dict;
  } finally {
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function enforceConstraints(prompt: string, plan: RuntimePlanAssessment): string {
  const constraints = [...plan.policies.applied, ...plan.rules.applied]
    .map((record) => record.constraint_text?.trim())
    .filter((value): value is string => Boolean(value));
  if (constraints.length === 0) return prompt;
  const lines = constraints.map((constraint, index) => `${index + 1}. ${constraint}`);
  return `${prompt.trim()}\n\n## Runtime-enforced constraints\n${lines.join('\n')}\n`;
}

function checkOutputExpression(expr: string, renderedPrompt: string, inputs: Dict): boolean {
  const containsMatch = expr.match(/^rendered_prompt\s+contains\s+['"](.+)['"]$/);
  if (containsMatch) return renderedPrompt.includes(containsMatch[1] ?? '');
  const jsExpr = expr.replaceAll('len(rendered_prompt)', String(renderedPrompt.length));
  return evaluateConditionForTest(jsExpr, { ...inputs, rendered_prompt: renderedPrompt });
}

function missingRequiredFields(contract: DomainContract, inputs: Dict): string[] {
  const missing = new Set<string>();
  for (const field of contract.fields?.required ?? []) if (inputs[field.name] === undefined || inputs[field.name] === null || inputs[field.name] === '') missing.add(field.name);
  for (const field of contract.fields?.optional ?? []) {
    if (!field.required_if) continue;
    if (evaluateConditionForTest(field.required_if, inputs) && (inputs[field.name] === undefined || inputs[field.name] === null || inputs[field.name] === '')) missing.add(field.name);
  }
  return [...missing].sort();
}

function forbiddenCombinationViolations(contract: DomainContract, inputs: Dict): string[] {
  return (contract.fields?.forbidden_combinations ?? [])
    .filter((combo) => combo.fields.length > 0 && combo.fields.every((fieldName) => active(inputs[fieldName])))
    .map((combo) => `${combo.fields.join(' + ')}${combo.reason ? ` — ${combo.reason}` : ''}`);
}

function executeDomainValidator(
  check: DomainValidator,
  validatorsPath: string,
  contract: DomainContract,
  plan: RuntimePlanAssessment,
  renderedPrompt: string,
): ValidationCheckRecord {
  const generationPlan = plan.generationPlan;
  const id = String(check.id ?? 'unnamed_check');
  const blocking = String(check.severity ?? 'warning') === 'error';
  const evaluationInputs = { ...generationPlan.contract.resolved_inputs, rendered_prompt: renderedPrompt };
  let applicable = true;
  try {
    applicable = check.applies_when === undefined || evaluateConditionForTest(String(check.applies_when), evaluationInputs);
  } catch (error) {
    return {
      check_id: id,
      source: validatorsPath,
      applicable: true,
      executed: true,
      passed: false,
      blocking,
      diagnostics: [`applies_when evaluation failed: ${(error as Error).message}`],
      evidence: { applies_when: check.applies_when ?? null, type: check.type ?? null },
    };
  }
  if (!applicable) return { check_id: id, source: validatorsPath, applicable: false, executed: false, passed: null, blocking, diagnostics: [], evidence: { applies_when: check.applies_when ?? null, type: check.type ?? null } };
  const diagnostics: string[] = [];
  let passed = true;
  try {
    if (check.type === 'contract_check') {
      const missing = missingRequiredFields(contract, generationPlan.contract.resolved_inputs);
      passed = missing.length === 0;
      if (!passed) diagnostics.push(`Missing required fields: ${missing.join(', ')}`);
    } else if (check.type === 'rule_presence') {
      const required = String(check.required_policy_id ?? '');
      passed = !required || generationPlan.policies.applied.some((item) => item.rule_id === required);
      if (!passed) diagnostics.push(String(check.message ?? `Required policy not applied: ${required}`));
    } else if (check.type === 'forbidden_instruction') {
      const matches = (check.forbidden_patterns ?? []).filter((pattern) => renderedPrompt.toLowerCase().includes(pattern.toLowerCase()));
      passed = matches.length === 0;
      diagnostics.push(...matches.map((pattern) => `Forbidden instruction found: ${pattern}`));
    } else if (check.type === 'field_check') {
      passed = evaluateConditionForTest(String(check.check ?? ''), generationPlan.contract.resolved_inputs);
      if (!passed) diagnostics.push(String(check.message ?? `Field check failed: ${id}`));
    } else if (check.type === 'output_check') {
      passed = checkOutputExpression(String(check.check ?? ''), renderedPrompt, generationPlan.contract.resolved_inputs);
      if (!passed) diagnostics.push(String(check.message ?? `Output check failed: ${id}`));
    } else if (check.type === 'forbidden_combination') {
      const violations = forbiddenCombinationViolations(contract, generationPlan.contract.resolved_inputs);
      passed = violations.length === 0;
      diagnostics.push(...violations.map((message) => `Forbidden input combination: ${message}`));
    } else {
      passed = false;
      diagnostics.push(`Unsupported validator type: ${String(check.type ?? '<missing>')}`);
    }
  } catch (error) {
    passed = false;
    diagnostics.push(`validator execution failed: ${(error as Error).message}`);
  }
  return {
    check_id: id,
    source: validatorsPath,
    applicable: true,
    executed: true,
    passed,
    blocking,
    diagnostics,
    evidence: { applies_when: check.applies_when ?? null, type: check.type ?? null },
  };
}

function buildCanonicalLedger(
  plan: RuntimePlanAssessment,
  config: PEaCConfig,
  renderedPrompt: string,
  checkout: CheckoutIdentity,
  integrity: CompletionIntegrity,
): ValidationCheckRecord[] {
  const generationPlan = plan.generationPlan;
  const envelope = plan.validatedIntake;
  const contractDefinition = readYamlFile<DomainContract>(generationPlan.contract.source_path) ?? {};
  const sources = [...plan.governingSources];
  const records: ValidationCheckRecord[] = [
    { check_id: 'artifact_integrity', source: 'runtime-artifact-envelope', applicable: true, executed: true, passed: integrity.artifact_valid, blocking: true, diagnostics: integrity.artifact_valid ? [] : ['Artifact SHA-256 mismatch.'], evidence: {} },
    { check_id: 'canonical_intake_digest', source: envelope.schema_id, applicable: true, executed: true, passed: sha256Json(envelope.normalized_inputs) === envelope.intake_digest, blocking: true, diagnostics: [], evidence: { intake_digest: envelope.intake_digest } },
    { check_id: 'domain_contract', source: generationPlan.contract.source_path, applicable: true, executed: true, passed: resolveAndValidateContract(contractDefinition, generationPlan.contract.resolved_inputs).errors.length === 0, blocking: true, diagnostics: [], evidence: { source_sha256: generationPlan.contract.source_sha256, resolved_inputs_sha256: sha256Json(generationPlan.contract.resolved_inputs) } },
    { check_id: 'envelope_integrity', source: 'runtime-artifact-envelope', applicable: true, executed: true, passed: integrity.envelope_valid, blocking: true, diagnostics: integrity.envelope_valid ? [] : ['Envelope SHA-256 mismatch.'], evidence: {} },
    { check_id: 'governing_sources_integrity', source: 'canonical-governing-sources', applicable: true, executed: true, passed: integrity.governing_sources_valid, blocking: true, diagnostics: integrity.governing_sources_valid ? [] : ['One or more governing sources are unavailable or changed.'], evidence: { source_count: sources.length } },
    { check_id: 'policy_rule_carriers', source: 'compiled-policy-and-domain-rules', applicable: true, executed: true, passed: [...generationPlan.policies.applicable, ...generationPlan.rules.applicable].every((item) => item.execution_result === 'applied'), blocking: true, diagnostics: [...generationPlan.policies.applicable, ...generationPlan.rules.applicable].flatMap((item) => item.diagnostics), evidence: {} },
    generationPlan.risk.review_required
      ? { check_id: 'review_eligibility', source: 'canonical-authority-reducer', applicable: true, executed: true, passed: true, blocking: false, diagnostics: [], evidence: { review_required: true } }
      : { check_id: 'review_eligibility', source: 'canonical-authority-reducer', applicable: false, executed: false, passed: null, blocking: false, diagnostics: [], evidence: { review_required: false } },
    { check_id: 'runtime_risk_derivation', source: 'src/runtime-authority-risk.ts', applicable: true, executed: true, passed: true, blocking: true, diagnostics: generationPlan.risk.unknowns.map((item) => `unknown:${item}`), evidence: { classification: generationPlan.risk.classification, decision: generationPlan.risk.decision } },
    { check_id: 'runtime_routing_derivation', source: 'pipeline/router.yaml', applicable: true, executed: true, passed: true, blocking: true, diagnostics: generationPlan.routing.hint_conflict ? ['caller domain hint conflicts with Runtime route'] : [], evidence: { domain: generationPlan.routing.domain, method: generationPlan.routing.method } },
  ];
  if (envelope.source_mode === 'fixture_validation') records.push({ check_id: 'checkout_identity', source: checkout.source, applicable: false, executed: false, passed: null, blocking: true, diagnostics: [], evidence: {} });
  else {
    const passed = Boolean(checkout.actual_sha) && (!checkout.expected_sha || checkout.actual_sha === checkout.expected_sha);
    const diagnostics = !checkout.actual_sha ? ['Actual checkout commit could not be resolved.'] : checkout.expected_sha && checkout.actual_sha !== checkout.expected_sha ? [`Actual checkout SHA ${checkout.actual_sha} does not match expected tested SHA ${checkout.expected_sha}.`] : [];
    records.push({ check_id: 'checkout_identity', source: checkout.source, applicable: true, executed: true, passed, blocking: true, diagnostics, evidence: { actual_sha: checkout.actual_sha, expected_sha: checkout.expected_sha } });
  }
  for (const item of generationPlan.policies.applicable) records.push({ check_id: `policy:${item.rule_id}`, source: item.source_path, applicable: true, executed: true, passed: item.execution_result === 'applied', blocking: true, diagnostics: item.diagnostics, evidence: { source_sha256: item.source_sha256, carrier: item.carrier } });
  for (const item of generationPlan.rules.applicable) records.push({ check_id: `rule:${item.rule_id}`, source: item.source_path, applicable: true, executed: true, passed: item.execution_result === 'applied', blocking: true, diagnostics: item.diagnostics, evidence: { source_sha256: item.source_sha256, carrier: item.carrier } });
  for (const item of sources) {
    const available = existsSync(item.path);
    const actualHash = available ? sha256File(item.path) : null;
    records.push({ check_id: `source:${item.path}`, source: item.path, applicable: true, executed: true, passed: available && actualHash === item.sha256, blocking: true, diagnostics: !available ? ['Governing source unavailable.'] : actualHash !== item.sha256 ? ['Governing source hash mismatch.'] : [], evidence: { expected_sha256: item.sha256, actual_sha256: actualHash } });
  }
  const validators = validatorDefinitions(config, generationPlan.routing.domain);
  for (const check of validators.checks) records.push(executeDomainValidator(check, validators.path, contractDefinition, plan, renderedPrompt));
  return records.sort((a, b) => a.check_id.localeCompare(b.check_id));
}

export function legacyValidationProjection(ledger: readonly ValidationCheckRecord[], config: PEaCConfig, domain: string): LegacyValidationProjection {
  const validatorIds = new Set(validatorDefinitions(config, domain).checks.map((check) => String(check.id ?? 'unnamed_check')));
  const records = ledger.filter((record) => validatorIds.has(record.check_id));
  const errors = records.filter((record) => record.applicable && record.passed === false && record.blocking).flatMap((record) => record.diagnostics.length > 0 ? record.diagnostics : [`Check failed: ${record.check_id}`]);
  const warnings = records.filter((record) => record.applicable && record.passed === false && !record.blocking).flatMap((record) => record.diagnostics.length > 0 ? record.diagnostics : [`Check failed: ${record.check_id}`]);
  const passed = records.every((record) => !record.applicable || !record.blocking || (record.executed && record.passed === true));
  return { passed, warnings, errors, checks_run: records.filter((record) => record.applicable).map((record) => record.check_id).sort() };
}

function assertCanonicalCompletionLedger(plan: RuntimePlanAssessment, ledger: readonly ValidationCheckRecord[]): asserts ledger is NonEmptyValidationLedger {
  if (plan.requiredChecks.length === 0) throw new Error('Completion requires a non-empty required Check set.');
  if (ledger.length === 0) throw new Error('Completion requires a non-empty validation ledger.');
  const expected = plan.requiredChecks.map((item) => item.check_id).sort();
  const actual = ledger.map((item) => item.check_id).sort();
  const duplicates = actual.filter((id, index) => actual.indexOf(id) !== index);
  if (duplicates.length > 0) throw new Error(`Completion ledger contains duplicate Check IDs: ${[...new Set(duplicates)].join(', ')}`);
  const missing = expected.filter((id) => !actual.includes(id));
  const unexpected = actual.filter((id) => !expected.includes(id));
  if (missing.length > 0) throw new Error(`Completion ledger is missing required Check IDs: ${missing.join(', ')}`);
  if (unexpected.length > 0) throw new Error(`Completion ledger contains unexpected Check IDs: ${unexpected.join(', ')}`);
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error('Completion ledger does not exactly match the canonical required Check set.');
  for (const record of ledger) {
    if (!record.applicable && (record.executed || record.passed !== null)) throw new Error(`Non-applicable Check has invalid execution semantics: ${record.check_id}`);
    if (record.applicable && !record.executed) throw new Error(`Applicable Check was not executed: ${record.check_id}`);
    if (record.applicable && record.passed === null) throw new Error(`Applicable Check has no result: ${record.check_id}`);
  }
}

function deriveAuthorityDecisionInternal(input: {
  sourceMode: RuntimePlanAssessment['validatedIntake']['source_mode'];
  riskAssessment: RuntimePlanAssessment['risk'];
  validationLedger: NonEmptyValidationLedger;
  checkoutIdentity: CheckoutIdentity;
  reviewReceipt: ArtifactReviewReceipt | null;
  artifactSha256: string | null;
}): AuthorityDecision {
  const reviewRequired = input.riskAssessment.review_required;
  if (input.sourceMode === 'fixture_validation') return { authority_state: 'non_authoritative_fixture', downstream_use_allowed: false, review_required: reviewRequired, diagnostics: ['Fixture mode is never authoritative.'] };
  const blockingFailure = input.validationLedger.some((check) => check.applicable && check.blocking && (!check.executed || check.passed !== true));
  if (blockingFailure) return { authority_state: 'rejected', downstream_use_allowed: false, review_required: reviewRequired, diagnostics: ['At least one applicable blocking Check failed or was not executed.'] };
  if (!input.checkoutIdentity.actual_sha) return { authority_state: 'rejected', downstream_use_allowed: false, review_required: reviewRequired, diagnostics: ['Actual checkout commit could not be resolved.'] };
  if (input.checkoutIdentity.expected_sha && input.checkoutIdentity.actual_sha !== input.checkoutIdentity.expected_sha) return { authority_state: 'rejected', downstream_use_allowed: false, review_required: reviewRequired, diagnostics: [`Actual checkout SHA ${input.checkoutIdentity.actual_sha} does not match expected tested SHA ${input.checkoutIdentity.expected_sha}.`] };
  const receipt = input.reviewReceipt;
  if (receipt) {
    if (receipt.receipt_type !== 'artifact_review' || receipt.receipt_version !== 'artifact-review.v1' || receipt.reviewer !== 'owner' || !['approved', 'rejected'].includes(receipt.decision)) return { authority_state: 'rejected', downstream_use_allowed: false, review_required: reviewRequired, diagnostics: ['Review receipt shape is invalid.'] };
    if (!input.artifactSha256 || receipt.artifact_sha256 !== input.artifactSha256) return { authority_state: 'rejected', downstream_use_allowed: false, review_required: reviewRequired, diagnostics: ['Review receipt is not bound to the exact current Artifact.'] };
    if (receipt.decision === 'rejected') return { authority_state: 'rejected', downstream_use_allowed: false, review_required: reviewRequired, diagnostics: ['Owner review rejected the Artifact.'] };
  }
  if (reviewRequired) {
    if (receipt?.decision === 'approved') return { authority_state: 'authorized', downstream_use_allowed: true, review_required: true, diagnostics: [] };
    return { authority_state: 'review_pending', downstream_use_allowed: false, review_required: true, diagnostics: ['Canonical Runtime risk requires an exact Artifact-bound owner review.'] };
  }
  if (receipt) return { authority_state: 'rejected', downstream_use_allowed: false, review_required: false, diagnostics: ['Review receipt was supplied for an Artifact that was not canonically review-eligible.'] };
  return { authority_state: 'authorized', downstream_use_allowed: true, review_required: false, diagnostics: [] };
}

export interface CompleteRuntimeAssessmentInput {
  plan: RuntimePlanAssessment;
  renderedPrompt: string;
  checkoutIdentity: CheckoutIdentity;
  integrity: CompletionIntegrity;
  reviewReceipt: ArtifactReviewReceipt | null;
  artifactSha256: string | null;
  config: PEaCConfig;
}

/** @internal Official callers are generate/verify/review only. */
export function completeRuntimeAssessmentInternal(input: CompleteRuntimeAssessmentInput): CompletedRuntimeAssessment {
  assertRuntimePlan(input.plan);
  if (typeof input.renderedPrompt !== 'string' || input.renderedPrompt.trim().length === 0) throw new Error('Completed Runtime assessment requires a rendered Prompt.');
  if (!input.checkoutIdentity || input.checkoutIdentity.source !== 'git rev-parse HEAD') throw new Error('Completed Runtime assessment requires evaluated checkout identity.');
  if (!input.integrity) throw new Error('Completed Runtime assessment requires integrity inputs.');
  const ledger = buildCanonicalLedger(input.plan, input.config, input.renderedPrompt, input.checkoutIdentity, input.integrity);
  assertCanonicalCompletionLedger(input.plan, ledger);
  const compatibilityValidation = legacyValidationProjection(ledger, input.config, input.plan.routing.domain);
  const authorityDecision = deriveAuthorityDecisionInternal({
    sourceMode: input.plan.validatedIntake.source_mode,
    riskAssessment: input.plan.risk,
    validationLedger: ledger,
    checkoutIdentity: input.checkoutIdentity,
    reviewReceipt: input.reviewReceipt,
    artifactSha256: input.artifactSha256,
  });
  return {
    plan: input.plan,
    renderedPrompt: input.renderedPrompt,
    validationLedger: ledger,
    checkoutIdentity: input.checkoutIdentity,
    compatibilityValidation,
    authorityDecision,
  };
}

/** @internal Test seam; not re-exported by the official Runtime API. */
export function completeRuntimeAssessmentForTest(input: CompleteRuntimeAssessmentInput): CompletedRuntimeAssessment {
  return completeRuntimeAssessmentInternal(input);
}

/** @internal Test seam for exact completion invariants; cannot issue authority. */
export function validateCompletionLedgerForTest(plan: RuntimePlanAssessment, ledger: readonly ValidationCheckRecord[]): void {
  assertRuntimePlan(plan);
  assertCanonicalCompletionLedger(plan, ledger);
}
