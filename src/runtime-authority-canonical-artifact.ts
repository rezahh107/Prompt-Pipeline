import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import yaml from 'js-yaml';
import type { Dict, ExecutionMode, PEaCConfig } from './peac.js';
import { loadConfig } from './peac.js';
import {
  type AuthorityState,
  type CanonicalDerivedProjection,
  type GoverningSource,
  type RuntimeArtifactEnvelope,
  type RuntimePlanAssessment,
  type ValidatedIntakeEnvelope,
  assertValidatedEnvelope,
  canonicalJson,
  createFixtureEnvelope,
  createValidatedIntakeEnvelope,
  parseDataFile,
  sha256Json,
  sha256Text,
} from './runtime-authority-foundation.js';
import { compileRuntimePlan } from './runtime-authority-payload-policy.js';
import {
  completeRuntimeAssessmentInternal,
  currentCheckoutIdentity,
  enforceConstraints,
  renderThroughStagedLegacy,
} from './runtime-authority-execution.js';
import { buildCanonicalDerivedProjection } from './runtime-authority-artifact.js';
import { delegatedRenderProjection, delegatedTargetFromPlan, delegationProvenance } from './runtime-authority-delegation.js';

export interface PersistedCanonicalIntake {
  schema_id: 'peac.validated-intake';
  schema_version: 'validated-intake.v1';
  intake_digest: string;
  raw_request_digest: string;
  source_mode: 'interactive_request' | 'api_request' | 'fixture_validation';
  normalized_inputs: Dict;
}

export interface CanonicalArtifactBase {
  canonicalIntake: PersistedCanonicalIntake;
  executionContext: {
    mode: ExecutionMode;
  };
}

export interface CanonicalPromptIdentity {
  promptId: string;
  domain: string;
  subtype: string | null;
  templatePath: string | null;
  templateVersion: string;
}

export interface IdentityCompatibilityProjection {
  prompt_id: string;
  execution_mode: ExecutionMode;
}

export interface LegacyCompatibilityView {
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

function normalizedSegment(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return result || 'default';
}

function selectedTemplatePath(plan: RuntimePlanAssessment): string | null {
  return plan.governingSources.find((source) => /[\\/]templates[\\/]/.test(source.path))?.path ?? null;
}

export function deriveCanonicalPromptIdentity(plan: RuntimePlanAssessment): CanonicalPromptIdentity {
  const templatePath = selectedTemplatePath(plan);
  const templateName = templatePath ? basename(templatePath, extname(templatePath)) : 'template';
  const subtype = plan.routing.subtype;
  const templateVersion = plan.generationPlan.contract.version;
  const promptId = [
    normalizedSegment(plan.routing.domain),
    normalizedSegment(subtype ?? 'default'),
    normalizedSegment(templateName),
    normalizedSegment(templateVersion),
  ].join('.');
  return {
    promptId,
    domain: plan.routing.domain,
    subtype,
    templatePath,
    templateVersion,
  };
}

export function canonicalIntakeProjection(envelope: ValidatedIntakeEnvelope): PersistedCanonicalIntake {
  return {
    schema_id: envelope.schema_id,
    schema_version: envelope.schema_version,
    intake_digest: envelope.intake_digest,
    raw_request_digest: envelope.raw_request_digest,
    source_mode: envelope.source_mode,
    normalized_inputs: envelope.normalized_inputs,
  };
}

export function buildCanonicalArtifactBase(
  envelope: ValidatedIntakeEnvelope,
  mode: ExecutionMode,
): CanonicalArtifactBase {
  return {
    canonicalIntake: canonicalIntakeProjection(envelope),
    executionContext: { mode },
  };
}

export function identityCompatibilityProjection(
  base: CanonicalArtifactBase,
  identity: CanonicalPromptIdentity,
): IdentityCompatibilityProjection {
  return {
    prompt_id: identity.promptId,
    execution_mode: base.executionContext.mode,
  };
}

function publicationDirectory(config: PEaCConfig, state: AuthorityState): string {
  if (state === 'authorized') return join(config.outputs_path, 'authorized');
  if (state === 'review_pending') return join(config.outputs_path, 'review-pending');
  if (state === 'non_authoritative_fixture') return join(config.outputs_path, 'fixtures');
  return join(config.outputs_path, 'rejected');
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing Artifact: ${path}`);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, yaml.dump(value, { lineWidth: 120, noRefs: true }));
  renameSync(temporary, path);
}

export function projectLegacyArtifactFields(derived: CanonicalDerivedProjection): LegacyCompatibilityView {
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

export function extractLegacyArtifactFields(artifact: Dict): LegacyCompatibilityView | null {
  const runtime = isRecord(artifact.runtime) ? artifact.runtime : null;
  if (!runtime) return null;
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
      git_commit_sha: typeof runtime.git_commit_sha === 'string' ? runtime.git_commit_sha : null,
      expected_tested_sha: typeof runtime.expected_tested_sha === 'string' ? runtime.expected_tested_sha : null,
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

export function buildArtifactHashes(
  canonicalIntake: PersistedCanonicalIntake,
  renderedPrompt: string,
  derived: CanonicalDerivedProjection,
): Dict {
  const sources = derived.governingSources;
  return {
    rendered_prompt_hash: sha256Text(renderedPrompt),
    normalized_inputs_hash: sha256Json(canonicalIntake.normalized_inputs),
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

export function isRecord(value: unknown): value is Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalExpectedSourcePaths(
  plan: RuntimePlanAssessment,
  _identity: CanonicalPromptIdentity,
  _config: PEaCConfig,
): string[] {
  return [...new Set(plan.governingSources.map((source) => source.path))].sort();
}

function rawIntakeFromRequestArgument(value: string): unknown {
  if (existsSync(value)) return parseDataFile(value);
  return { request: value, desired_output: 'copy-ready prompt', target_environment: 'unspecified', strictness: 'precise' };
}

function assertLegacyRenderIdentity(
  plan: RuntimePlanAssessment,
  identity: CanonicalPromptIdentity,
  legacyArtifact: Dict,
): void {
  const delegated = delegatedRenderProjection(plan);
  const expectedDomain = delegated?.domain ?? identity.domain;
  const expectedSubtype = delegated?.subtype ?? identity.subtype;
  const observedDomain = String(legacyArtifact.domain ?? '');
  const observedSubtype = legacyArtifact.subtype === null ? null : String(legacyArtifact.subtype ?? '');
  const provenance = isRecord(legacyArtifact.provenance) ? legacyArtifact.provenance : {};
  const observedTemplate = typeof provenance.template_used === 'string' ? provenance.template_used : null;
  if (observedDomain !== expectedDomain) {
    throw new Error(`Legacy renderer changed canonical render Domain: expected ${expectedDomain}, got ${observedDomain || '<missing>'}.`);
  }
  if (observedSubtype !== expectedSubtype) {
    throw new Error(`Legacy renderer changed canonical render Subtype: expected ${String(expectedSubtype)}, got ${String(observedSubtype)}.`);
  }
  if (!identity.templatePath || !observedTemplate || resolve(identity.templatePath) !== resolve(observedTemplate)) {
    throw new Error(`Legacy renderer changed canonical template identity: expected ${String(identity.templatePath)}, got ${String(observedTemplate)}.`);
  }
}

export function generateArtifact(
  envelope: ValidatedIntakeEnvelope,
  mode: ExecutionMode = 'batch',
  configOverride?: PEaCConfig,
): { artifact: RuntimeArtifactEnvelope; outputPath: string } {
  assertValidatedEnvelope(envelope);
  const config = configOverride ?? loadConfig();
  const plan = compileRuntimePlan(envelope, config);
  const delegated = delegatedTargetFromPlan(plan);
  const canonicalIdentity = deriveCanonicalPromptIdentity(plan);
  const legacyArtifact = renderThroughStagedLegacy(plan, mode, config);
  assertLegacyRenderIdentity(plan, canonicalIdentity, legacyArtifact);
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
  const canonicalBase = buildCanonicalArtifactBase(envelope, mode);
  const identityProjection = identityCompatibilityProjection(canonicalBase, canonicalIdentity);
  const observedRuntime = isRecord(legacyArtifact.runtime) ? legacyArtifact.runtime : {};
  const delegation = delegationProvenance(plan);
  const artifactPayload: Dict = {
    ...identityProjection,
    generated_at: new Date().toISOString(),
    rendered_prompt: renderedPrompt,
    canonical_base: canonicalBase,
    canonical_prompt_identity: canonicalIdentity,
    canonical_intake: canonicalBase.canonicalIntake,
    derived_projection: derived,
    ...(delegation ? { delegation_provenance: delegation } : {}),
    ...compatibility,
    runtime: {
      node_version: String(observedRuntime.node_version ?? process.version),
      package_manager: observedRuntime.package_manager ?? null,
      pipeline_version: observedRuntime.pipeline_version ?? config.version ?? null,
      ...compatibility.runtime,
    },
    hashes: buildArtifactHashes(canonicalBase.canonicalIntake, renderedPrompt, derived),
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
  const schemaVersion = delegated ? 'runtime-artifact-envelope.v2' : 'runtime-artifact-envelope.v1';
  const partial = {
    schema_id: 'peac.runtime-artifact-envelope',
    schema_version: schemaVersion,
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
  const artifact = { ...partial, envelope_sha256: sha256Json(partial) } as unknown as RuntimeArtifactEnvelope;
  const outputPath = join(
    publicationDirectory(config, finalCompleted.authorityDecision.authority_state),
    `${canonicalIdentity.promptId.replaceAll('.', '-')}-${artifact.artifact_sha256.slice(0, 16)}.yaml`,
  );
  writeAtomic(outputPath, artifact);
  return { artifact, outputPath };
}

export function generateFromCliArgs(args: Record<string, string | boolean>): { artifact: RuntimeArtifactEnvelope; outputPath: string } {
  const mode = typeof args.mode === 'string' ? args.mode as ExecutionMode : 'batch';
  if (typeof args.case === 'string') return generateArtifact(createFixtureEnvelope(args.case), mode);
  if (typeof args.request !== 'string' || args.request.trim() === '') throw new Error('Provide --request <intake-file-or-text> or --case <fixture-file>.');
  return generateArtifact(createValidatedIntakeEnvelope(rawIntakeFromRequestArgument(args.request), 'interactive_request'), mode);
}

export function compareCanonical(label: string, actual: unknown, expected: unknown, target: string[]): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) target.push(`${label} differs from canonical Runtime recomputation.`);
}
