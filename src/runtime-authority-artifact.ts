import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';
import { loadConfig, type Dict, type ExecutionMode, type PEaCConfig } from './peac.js';
import {
  type AssuranceProjection,
  type AuthorityState,
  type CanonicalDerivedProjection,
  type CanonicalPolicyProjection,
  type CompletedRuntimeAssessment,
  type DerivedRisk,
  type GoverningSource,
  type RuntimeArtifactEnvelope,
  type RuntimePlanAssessment,
  type ValidatedIntakeEnvelope,
  type VerificationResult,
  type VerificationStatus,
  assertValidatedEnvelope,
  canonicalJson,
  createFixtureEnvelope,
  createValidatedIntakeEnvelope,
  formatAjvErrors,
  parseDataFile,
  rehydrateEnvelope,
  sha256File,
  sha256Json,
  sha256Text,
} from './runtime-authority-foundation.js';
import { compileRuntimePlan } from './runtime-authority-plan.js';
import {
  completeRuntimeAssessmentInternal,
  currentCheckoutIdentity,
  enforceConstraints,
  renderThroughStagedLegacy,
} from './runtime-authority-execution.js';

function envelopeDigestInput(envelope: Omit<RuntimeArtifactEnvelope, 'envelope_sha256'>): unknown {
  return envelope;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing Artifact: ${path}`);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, yaml.dump(value, { lineWidth: 120, noRefs: true }));
  renameSync(temporary, path);
}

function publicationDirectory(config: PEaCConfig, state: AuthorityState): string {
  if (state === 'authorized') return join(config.outputs_path, 'authorized');
  if (state === 'review_pending') return join(config.outputs_path, 'review-pending');
  if (state === 'non_authoritative_fixture') return join(config.outputs_path, 'fixtures');
  return join(config.outputs_path, 'rejected');
}

function legacyRisk(classification: DerivedRisk): 'low' | 'medium' | 'high' {
  if (classification === 'low') return 'low';
  if (classification === 'medium') return 'medium';
  return 'high';
}

function assuranceProjection(completed: CompletedRuntimeAssessment): AssuranceProjection {
  return {
    profile: completed.plan.generationPlan.evaluation.profile,
    validation_kind: 'static_prompt_and_metadata_only',
    target_model_executed: false,
    behavioral_success_observed: false,
    semantic_correctness_claimed: false,
  };
}

function policyProjection(completed: CompletedRuntimeAssessment): CanonicalPolicyProjection[] {
  return completed.plan.policies.applied.map((item) => ({
    id: item.rule_id,
    source_ref: item.source_path,
    source_hash: item.source_sha256,
    triggered_by: item.trigger_evidence.join(' OR '),
  })).sort((a, b) => a.id.localeCompare(b.id));
}

function templateSource(sources: readonly GoverningSource[]): string | null {
  return sources.find((item) => /[\\/]templates[\\/]/.test(item.path))?.path ?? null;
}

export function buildCanonicalDerivedProjection(completed: CompletedRuntimeAssessment): CanonicalDerivedProjection {
  const plan = completed.plan;
  const generationPlan = plan.generationPlan;
  const normalized = generationPlan.intake.normalized_inputs;
  const sources = [...plan.governingSources].sort((a, b) => a.path.localeCompare(b.path));
  return {
    generationPlan,
    validationLedger: completed.validationLedger,
    compatibilityValidation: completed.compatibilityValidation,
    routing: plan.routing,
    risk: plan.risk,
    legacyRiskLevel: legacyRisk(plan.risk.classification),
    requiresHumanReview: plan.risk.review_required,
    reviewReason: plan.risk.review_required ? plan.risk.decision : null,
    assurance: assuranceProjection(completed),
    contextAttribution: { state: plan.context.attribution_state, items: plan.context.items },
    domain: plan.routing.domain,
    subtype: plan.routing.subtype,
    provenance: {
      user_request: String(normalized.request ?? ''),
      case_file: plan.validatedIntake.source_mode === 'fixture_validation' ? 'fixture_validation' : null,
      routing_method: plan.routing.method,
      routing_confidence: plan.routing.confidence,
      routing_evidence: [...plan.routing.evidence],
      template_used: templateSource(sources),
      template_version: generationPlan.contract.version,
      inputs_provided: Object.keys(normalized).sort(),
      inputs_inferred: [],
      inputs_defaulted: [...generationPlan.contract.defaulted_inputs],
      canonical_intake_digest: plan.validatedIntake.intake_digest,
      checkout: completed.checkoutIdentity,
    },
    policiesApplied: policyProjection(completed),
    governingSources: sources,
    sourceHashes: { sources },
  };
}

interface LegacyCompatibilityView {
  domain: string;
  subtype: string | null;
  provenance: CanonicalDerivedProjection['provenance'];
  policies_applied: CanonicalDerivedProjection['policiesApplied'];
  validation: CanonicalDerivedProjection['compatibilityValidation'];
  risk_level: CanonicalDerivedProjection['legacyRiskLevel'];
  requires_human_review: boolean;
  review_reason: string | null;
  assurance: CanonicalDerivedProjection['assurance'];
  context_attribution: CanonicalDerivedProjection['contextAttribution'];
  governing_sources: CanonicalDerivedProjection['governingSources'];
  generation_plan: CanonicalDerivedProjection['generationPlan'];
  validation_ledger: { checks: CanonicalDerivedProjection['validationLedger'] };
  runtime: {
    git_commit_sha: string | null;
    expected_tested_sha: string | null;
    provenance_source: 'git rev-parse HEAD';
  };
}

function projectLegacyArtifactFields(derived: CanonicalDerivedProjection): LegacyCompatibilityView {
  return {
    domain: derived.domain,
    subtype: derived.subtype,
    provenance: derived.provenance,
    policies_applied: derived.policiesApplied,
    validation: derived.compatibilityValidation,
    risk_level: derived.legacyRiskLevel,
    requires_human_review: derived.requiresHumanReview,
    review_reason: derived.reviewReason,
    assurance: derived.assurance,
    context_attribution: derived.contextAttribution,
    governing_sources: derived.governingSources,
    generation_plan: derived.generationPlan,
    validation_ledger: { checks: derived.validationLedger },
    runtime: {
      git_commit_sha: derived.provenance.checkout.actual_sha,
      expected_tested_sha: derived.provenance.checkout.expected_sha,
      provenance_source: derived.provenance.checkout.source,
    },
  };
}

function extractLegacyArtifactFields(artifact: Dict): LegacyCompatibilityView {
  const runtime = artifact.runtime as Dict | undefined;
  return {
    domain: String(artifact.domain ?? ''),
    subtype: artifact.subtype === null ? null : String(artifact.subtype ?? ''),
    provenance: artifact.provenance as CanonicalDerivedProjection['provenance'],
    policies_applied: artifact.policies_applied as CanonicalDerivedProjection['policiesApplied'],
    validation: artifact.validation as CanonicalDerivedProjection['compatibilityValidation'],
    risk_level: artifact.risk_level as CanonicalDerivedProjection['legacyRiskLevel'],
    requires_human_review: artifact.requires_human_review === true,
    review_reason: artifact.review_reason === null ? null : String(artifact.review_reason ?? ''),
    assurance: artifact.assurance as CanonicalDerivedProjection['assurance'],
    context_attribution: artifact.context_attribution as CanonicalDerivedProjection['contextAttribution'],
    governing_sources: artifact.governing_sources as CanonicalDerivedProjection['governingSources'],
    generation_plan: artifact.generation_plan as CanonicalDerivedProjection['generationPlan'],
    validation_ledger: artifact.validation_ledger as { checks: CanonicalDerivedProjection['validationLedger'] },
    runtime: {
      git_commit_sha: typeof runtime?.git_commit_sha === 'string' ? runtime.git_commit_sha : null,
      expected_tested_sha: typeof runtime?.expected_tested_sha === 'string' ? runtime.expected_tested_sha : null,
      provenance_source: 'git rev-parse HEAD',
    },
  };
}

function hashForSuffix(sources: readonly GoverningSource[], suffix: string): string | null {
  return sources.find((item) => item.path.endsWith(suffix))?.sha256 ?? null;
}

function hashForContaining(sources: readonly GoverningSource[], marker: string): string | null {
  return sources.find((item) => item.path.includes(marker))?.sha256 ?? null;
}

function buildArtifactHashes(
  canonicalIntake: Dict,
  renderedPrompt: string,
  derived: CanonicalDerivedProjection,
): Dict {
  const sources = derived.governingSources;
  return {
    rendered_prompt_hash: sha256Text(renderedPrompt),
    normalized_inputs_hash: sha256Json((canonicalIntake.normalized_inputs as Dict | undefined) ?? {}),
    generation_plan_hash: sha256Json(derived.generationPlan),
    validation_ledger_hash: sha256Json(derived.validationLedger),
    derived_projection_hash: sha256Json(derived),
    config_hash: hashForSuffix(sources, 'peac.config.yaml'),
    contract_hash: hashForSuffix(sources, 'input.contract.yaml'),
    route_hash: hashForSuffix(sources, 'route.yaml'),
    template_hash: hashForContaining(sources, '/templates/'),
    validators_hash: hashForSuffix(sources, 'validators.yaml'),
    policies_hash: sha256Json(sources.filter((item) => item.path.includes('policies/')).map((item) => ({ path: item.path, sha256: item.sha256 }))),
  };
}

function canonicalIntakeProjection(envelope: ValidatedIntakeEnvelope): Dict {
  return {
    schema_id: envelope.schema_id,
    schema_version: envelope.schema_version,
    intake_digest: envelope.intake_digest,
    raw_request_digest: envelope.raw_request_digest,
    source_mode: envelope.source_mode,
    normalized_inputs: envelope.normalized_inputs,
  };
}

export function generateArtifact(
  envelope: ValidatedIntakeEnvelope,
  mode: ExecutionMode = 'batch',
  configOverride?: PEaCConfig,
): { artifact: RuntimeArtifactEnvelope; outputPath: string } {
  assertValidatedEnvelope(envelope);
  const config = configOverride ?? loadConfig();
  const plan = compileRuntimePlan(envelope, config);
  const legacyArtifact = renderThroughStagedLegacy(plan, mode, config);
  const renderedPrompt = enforceConstraints(String(legacyArtifact.rendered_prompt ?? ''), plan);
  const checkout = currentCheckoutIdentity();
  const completed = completeRuntimeAssessmentInternal({
    plan,
    renderedPrompt,
    checkoutIdentity: checkout,
    reviewReceipt: null,
    artifactSha256: null,
    integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true },
    config,
  });
  const derived = buildCanonicalDerivedProjection(completed);
  const compatibility = projectLegacyArtifactFields(derived);
  const canonicalIntake = canonicalIntakeProjection(envelope);
  const observedRuntime = legacyArtifact.runtime !== null && typeof legacyArtifact.runtime === 'object' && !Array.isArray(legacyArtifact.runtime) ? legacyArtifact.runtime as Dict : {};
  const artifactPayload: Dict = {
    prompt_id: String(legacyArtifact.prompt_id ?? `${derived.domain}.default.v1`),
    generated_at: new Date().toISOString(),
    execution_mode: String(legacyArtifact.execution_mode ?? mode),
    rendered_prompt: renderedPrompt,
    canonical_intake: canonicalIntake,
    derived_projection: derived,
    ...compatibility,
    runtime: {
      node_version: String(observedRuntime.node_version ?? process.version),
      package_manager: observedRuntime.package_manager ?? null,
      pipeline_version: observedRuntime.pipeline_version ?? config.version ?? null,
      ...compatibility.runtime,
    },
    hashes: buildArtifactHashes(canonicalIntake, renderedPrompt, derived),
  };
  const artifactSha = sha256Json(artifactPayload);
  const finalCompleted = completeRuntimeAssessmentInternal({
    plan,
    renderedPrompt,
    checkoutIdentity: checkout,
    reviewReceipt: null,
    artifactSha256: artifactSha,
    integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true },
    config,
  });
  const partial: Omit<RuntimeArtifactEnvelope, 'envelope_sha256'> = {
    schema_id: 'peac.runtime-artifact-envelope',
    schema_version: 'runtime-artifact-envelope.v1',
    artifact_sha256: artifactSha,
    artifact: artifactPayload,
    authorization: {
      authority_state: finalCompleted.authorityDecision.authority_state,
      downstream_use_allowed: finalCompleted.authorityDecision.downstream_use_allowed,
      review_required: finalCompleted.authorityDecision.review_required,
      review_receipt: null,
      diagnostics: finalCompleted.authorityDecision.diagnostics,
    },
  };
  const artifact: RuntimeArtifactEnvelope = { ...partial, envelope_sha256: sha256Json(envelopeDigestInput(partial)) };
  const id = String(artifactPayload.prompt_id).replaceAll('.', '-');
  const outputPath = join(publicationDirectory(config, finalCompleted.authorityDecision.authority_state), `${id}-${artifact.artifact_sha256.slice(0, 16)}.yaml`);
  writeAtomic(outputPath, artifact);
  return { artifact, outputPath };
}

function loadEnvelope(path: string): RuntimeArtifactEnvelope {
  const value = parseDataFile(path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Artifact envelope is not an object: ${path}`);
  return value as RuntimeArtifactEnvelope;
}

function artifactSchemaCheck(envelope: RuntimeArtifactEnvelope, config: PEaCConfig): string[] {
  const schemaPath = join(config.pipeline_path, 'runtime-artifact.schema.json');
  if (!existsSync(schemaPath)) return [`Missing Runtime Artifact schema: ${schemaPath}`];
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return validate(envelope) ? [] : formatAjvErrors(validate.errors);
}

function compareSemantic(label: string, actual: unknown, expected: unknown, diagnostics: string[]): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) diagnostics.push(`${label} differs from canonical Runtime recomputation.`);
}

function crossFieldInvariantDiagnostics(
  envelope: RuntimeArtifactEnvelope,
  completed: CompletedRuntimeAssessment,
): string[] {
  const diagnostics: string[] = [];
  const authorization = envelope.authorization;
  const derived = envelope.artifact.derived_projection as CanonicalDerivedProjection | undefined;
  if (completed.validationLedger.length === 0) diagnostics.push('Authorized state cannot exist without a non-empty completed validation ledger.');
  if (authorization.authority_state === 'authorized' && completed.validationLedger.some((item) => item.applicable && item.blocking && (!item.executed || item.passed !== true))) diagnostics.push('Authorized state has an unsatisfied blocking Check.');
  if (authorization.authority_state === 'review_pending' && (!authorization.review_required || authorization.downstream_use_allowed || authorization.review_receipt !== null)) diagnostics.push('review_pending cross-field invariant failed.');
  if (authorization.authority_state === 'authorized' && authorization.review_required && (!authorization.review_receipt || authorization.review_receipt.decision !== 'approved' || authorization.review_receipt.artifact_sha256 !== envelope.artifact_sha256)) diagnostics.push('Reviewed authorization lacks an exact approved Artifact-bound receipt.');
  if (derived && envelope.artifact.requires_human_review !== derived.risk.review_required) diagnostics.push('Legacy requires_human_review contradicts canonical risk.review_required.');
  if (derived && envelope.artifact.risk_level !== legacyRisk(derived.risk.classification)) diagnostics.push('Legacy risk_level contradicts canonical risk classification.');
  if (derived && canonicalJson(envelope.artifact.context_attribution) !== canonicalJson(derived.contextAttribution)) diagnostics.push('Legacy context_attribution contradicts canonical context projection.');
  return diagnostics;
}

export interface VerifiedRuntimeCompletionInternal {
  verificationResult: VerificationResult;
  completedAssessment: CompletedRuntimeAssessment;
  artifactEnvelope: RuntimeArtifactEnvelope;
}

function verifyArtifactDetailed(path: string, config: PEaCConfig): { result: VerificationResult; capability: VerifiedRuntimeCompletionInternal | null } {
  const diagnostics: string[] = [];
  let envelope: RuntimeArtifactEnvelope;
  try {
    envelope = loadEnvelope(path);
  } catch (error) {
    return {
      result: { verification_status: 'rejected', integrity_valid: false, semantic_derivation_valid: false, authority_consistent: false, artifact_sha256: null, authority_state: null, downstream_use_allowed: false, checks: [], diagnostics: [(error as Error).message] },
      capability: null,
    };
  }

  const schemaErrors = artifactSchemaCheck(envelope, config);
  diagnostics.push(...schemaErrors);
  const artifactValid = sha256Json(envelope.artifact) === envelope.artifact_sha256;
  if (!artifactValid) diagnostics.push('Artifact SHA-256 mismatch.');
  const { envelope_sha256: _ignored, ...withoutEnvelopeDigest } = envelope;
  const envelopeValid = sha256Json(envelopeDigestInput(withoutEnvelopeDigest)) === envelope.envelope_sha256;
  if (!envelopeValid) diagnostics.push('Envelope SHA-256 mismatch.');

  const artifact = envelope.artifact;
  const intakeValue = artifact.canonical_intake;
  const intake = intakeValue !== null && typeof intakeValue === 'object' && !Array.isArray(intakeValue) ? intakeValue as Dict : null;
  if (!intake) diagnostics.push('Canonical intake is missing.');
  const persistedSources = Array.isArray(artifact.governing_sources) ? artifact.governing_sources as GoverningSource[] : [];
  const unavailableSource = persistedSources.some((source) => !source.path || !existsSync(source.path));
  const governingSourcesValid = persistedSources.length > 0 && persistedSources.every((source) => existsSync(source.path) && source.sha256 === sha256File(source.path));
  if (!governingSourcesValid) diagnostics.push('Persisted governing sources are unavailable or changed.');

  let completed: CompletedRuntimeAssessment | null = null;
  try {
    if (!intake) throw new Error('Canonical intake is unavailable.');
    const canonicalEnvelope = rehydrateEnvelope(intake, config);
    const plan = compileRuntimePlan(canonicalEnvelope, config);
    const executionMode = ['interactive', 'batch', 'ci', 'agent'].includes(String(artifact.execution_mode)) ? artifact.execution_mode as ExecutionMode : 'ci';
    const canonicalLegacy = renderThroughStagedLegacy(plan, executionMode, config);
    const expectedRenderedPrompt = enforceConstraints(String(canonicalLegacy.rendered_prompt ?? ''), plan);
    compareSemantic('rendered Prompt', artifact.rendered_prompt, expectedRenderedPrompt, diagnostics);
    const checkout = currentCheckoutIdentity();
    completed = completeRuntimeAssessmentInternal({
      plan,
      renderedPrompt: expectedRenderedPrompt,
      checkoutIdentity: checkout,
      reviewReceipt: envelope.authorization.review_receipt,
      artifactSha256: envelope.artifact_sha256,
      integrity: { artifact_valid: artifactValid, envelope_valid: envelopeValid, governing_sources_valid: governingSourcesValid },
      config,
    });
    const expectedDerived = buildCanonicalDerivedProjection(completed);
    compareSemantic('canonical derived projection', artifact.derived_projection, expectedDerived, diagnostics);
    const expectedLegacy = projectLegacyArtifactFields(expectedDerived);
    compareSemantic('legacy compatibility projection', extractLegacyArtifactFields(artifact), expectedLegacy, diagnostics);
    const expectedHashes = buildArtifactHashes(intake, expectedRenderedPrompt, expectedDerived);
    compareSemantic('Artifact hashes', artifact.hashes, expectedHashes, diagnostics);
    const expectedAuthorization = {
      authority_state: completed.authorityDecision.authority_state,
      downstream_use_allowed: completed.authorityDecision.downstream_use_allowed,
      review_required: completed.authorityDecision.review_required,
      review_receipt: envelope.authorization.review_receipt,
      diagnostics: completed.authorityDecision.diagnostics,
    };
    compareSemantic('authorization', envelope.authorization, expectedAuthorization, diagnostics);
    diagnostics.push(...crossFieldInvariantDiagnostics(envelope, completed));
  } catch (error) {
    diagnostics.push(`Canonical semantic recomputation failed: ${(error as Error).message}`);
  }

  const integrityDiagnostics = diagnostics.filter((item) => /schema|SHA-256|hashes|digest|integrity|governing sources/i.test(item));
  const integrityValid = schemaErrors.length === 0 && artifactValid && envelopeValid && governingSourcesValid && integrityDiagnostics.length === 0;
  const semanticDiagnostics = diagnostics.filter((item) => /canonical|projection|rendered Prompt|generation|validation|risk|routing|contract|policy|rule|context|provenance|cross-field/i.test(item));
  const semanticValid = completed !== null && semanticDiagnostics.length === 0;
  const authorityDiagnostics = diagnostics.filter((item) => item.startsWith('authorization') || item.includes('Authorized state') || item.includes('review_pending'));
  const authorityConsistent = completed !== null && authorityDiagnostics.length === 0;
  const verificationStatus: VerificationStatus = diagnostics.length === 0
    ? 'verified'
    : unavailableSource || diagnostics.some((item) => item.includes('Governing source unavailable'))
      ? 'insufficient_evidence'
      : 'rejected';
  const result: VerificationResult = {
    verification_status: verificationStatus,
    integrity_valid: integrityValid,
    semantic_derivation_valid: semanticValid,
    authority_consistent: authorityConsistent,
    artifact_sha256: envelope.artifact_sha256,
    authority_state: envelope.authorization.authority_state,
    downstream_use_allowed: verificationStatus === 'verified' && envelope.authorization.downstream_use_allowed,
    checks: completed ? [...completed.validationLedger] : [],
    diagnostics,
  };
  return {
    result,
    capability: verificationStatus === 'verified' && completed ? { verificationResult: result, completedAssessment: completed, artifactEnvelope: envelope } : null,
  };
}

export function verifyArtifact(path: string, configOverride?: PEaCConfig): VerificationResult {
  const config = configOverride ?? loadConfig();
  return verifyArtifactDetailed(path, config).result;
}

/** @internal Official review API only; not re-exported by runtime-authority.ts. */
export function verifyArtifactForReviewInternal(path: string, configOverride?: PEaCConfig): VerifiedRuntimeCompletionInternal {
  const config = configOverride ?? loadConfig();
  const detailed = verifyArtifactDetailed(path, config);
  if (!detailed.capability) throw new Error(`Cannot review an unverified Artifact: ${detailed.result.diagnostics.join('; ')}`);
  return detailed.capability;
}

function rawIntakeFromRequestArgument(value: string): unknown {
  if (existsSync(value)) return parseDataFile(value);
  return { request: value, desired_output: 'copy-ready prompt', target_environment: 'unspecified', strictness: 'precise' };
}

export function generateFromCliArgs(args: Record<string, string | boolean>): { artifact: RuntimeArtifactEnvelope; outputPath: string } {
  const mode = typeof args.mode === 'string' ? args.mode as ExecutionMode : 'batch';
  if (typeof args.case === 'string') return generateArtifact(createFixtureEnvelope(args.case), mode);
  if (typeof args.request !== 'string' || args.request.trim() === '') throw new Error('Provide --request <intake-file-or-text> or --case <fixture-file>.');
  return generateArtifact(createValidatedIntakeEnvelope(rawIntakeFromRequestArgument(args.request), 'interactive_request'), mode);
}
