import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Dict, ExecutionMode, PEaCConfig } from './peac.js';
import { loadConfig } from './peac.js';
import {
  type AuthorityState,
  type CompletedRuntimeAssessment,
  type RuntimeArtifactEnvelope,
  type ValidationCheckRecord,
  type VerificationResult,
  canonicalJson,
  formatAjvErrors,
  parseDataFile,
  rehydrateEnvelope,
  sha256File,
  sha256Json,
} from './runtime-authority-foundation.js';
import {
  safeParseEnvelope as safeParseEnvelopeV1,
  verifyArtifact as verifyArtifactV1,
  verifyArtifactForReviewInternal as verifyArtifactForReviewV1,
  type SafeEnvelopeParseResult,
  type VerifiedRuntimeCompletionInternal,
} from './runtime-authority-verification-facts.js';
import { compileRuntimePlan } from './runtime-authority-payload-policy.js';
import {
  buildArtifactHashes,
  buildCanonicalArtifactBase,
  canonicalExpectedSourcePaths,
  deriveCanonicalPromptIdentity,
  identityCompatibilityProjection,
  isRecord,
  projectLegacyArtifactFields,
} from './runtime-authority-canonical-artifact.js';
import {
  completeRuntimeAssessmentInternal,
  currentCheckoutIdentity,
  enforceConstraints,
  renderThroughStagedLegacy,
} from './runtime-authority-execution.js';
import { buildCanonicalDerivedProjection } from './runtime-authority-artifact.js';
import { delegatedTargetFromPlan, delegationProvenance } from './runtime-authority-delegation.js';

export type { SafeEnvelopeParseResult, VerifiedRuntimeCompletionInternal };

function authorityState(value: unknown): AuthorityState | null {
  return ['authorized', 'review_pending', 'rejected', 'non_authoritative_fixture'].includes(String(value))
    ? value as AuthorityState
    : null;
}

function rejected(diagnostics: string[]): VerificationResult {
  return {
    verification_status: 'rejected',
    integrity_valid: false,
    semantic_derivation_valid: false,
    authority_consistent: false,
    artifact_sha256: null,
    authority_state: null,
    downstream_use_allowed: false,
    checks: [],
    diagnostics,
  };
}

function rawSchemaVersion(path: string): string | null {
  try {
    const value = parseDataFile(path);
    return isRecord(value) && typeof value.schema_version === 'string' ? value.schema_version : null;
  } catch {
    return null;
  }
}

export function safeParseRuntimeEnvelope(path: string): SafeEnvelopeParseResult {
  if (rawSchemaVersion(path) !== 'runtime-artifact-envelope.v2') return safeParseEnvelopeV1(path);
  try {
    const value = parseDataFile(path);
    if (!isRecord(value)) return { envelope: null, structuralDiagnostics: ['Artifact envelope must be an object.'] };
    const diagnostics: string[] = [];
    if (!isRecord(value.artifact)) diagnostics.push('Artifact envelope.artifact must be an object.');
    if (!isRecord(value.authorization)) diagnostics.push('Artifact envelope.authorization must be an object.');
    if (typeof value.artifact_sha256 !== 'string') diagnostics.push('Artifact envelope.artifact_sha256 must be a string.');
    if (typeof value.envelope_sha256 !== 'string') diagnostics.push('Artifact envelope.envelope_sha256 must be a string.');
    return diagnostics.length > 0
      ? { envelope: null, structuralDiagnostics: diagnostics }
      : { envelope: value as unknown as RuntimeArtifactEnvelope, structuralDiagnostics: [] };
  } catch (error) {
    return { envelope: null, structuralDiagnostics: [`Artifact parse failed: ${(error as Error).message}`] };
  }
}

function schemaDiagnostics(envelope: RuntimeArtifactEnvelope, config: PEaCConfig): string[] {
  const schemaPath = join(config.pipeline_path, 'runtime-artifact.v2.schema.json');
  if (!existsSync(schemaPath)) return [`Runtime Artifact v2 schema is unavailable: ${schemaPath}`];
  try {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    return validate(envelope) ? [] : formatAjvErrors(validate.errors).map((item) => `Schema contradiction: ${item}`);
  } catch (error) {
    return [`Runtime Artifact v2 schema evaluation failed: ${(error as Error).message}`];
  }
}

function sourceDiagnostics(planSources: readonly { path: string; sha256: string }[], persisted: unknown): { diagnostics: string[]; unavailable: string[] } {
  const diagnostics: string[] = [];
  const unavailable: string[] = [];
  if (!Array.isArray(persisted)) return { diagnostics: ['Persisted governing_sources must be an array.'], unavailable };
  const records = persisted.filter((item): item is Dict => isRecord(item));
  const expectedPaths = [...new Set(planSources.map((item) => item.path))].sort();
  const observedPaths = [...new Set(records.map((item) => String(item.path ?? '')))].sort();
  if (canonicalJson(expectedPaths) !== canonicalJson(observedPaths)) diagnostics.push('Canonical governing source-set differs from persisted source inventory.');
  const observedByPath = new Map(records.map((item) => [String(item.path ?? ''), item]));
  for (const source of planSources) {
    const observed = observedByPath.get(source.path);
    if (!observed) continue;
    if (String(observed.sha256 ?? '') !== source.sha256) diagnostics.push(`Persisted governing source hash differs from canonical plan: ${source.path}`);
    if (!existsSync(source.path)) {
      unavailable.push(`Canonical governing source is unavailable: ${source.path}`);
      continue;
    }
    if (sha256File(source.path) !== source.sha256) diagnostics.push(`Canonical governing source hash changed: ${source.path}`);
  }
  return { diagnostics, unavailable };
}

function verifyV2Detailed(
  path: string,
  config: PEaCConfig,
): { result: VerificationResult; capability: VerifiedRuntimeCompletionInternal | null } {
  const parsed = safeParseRuntimeEnvelope(path);
  if (!parsed.envelope) return { result: rejected(parsed.structuralDiagnostics), capability: null };
  const envelope = parsed.envelope;
  const diagnostics = schemaDiagnostics(envelope, config);
  const unavailable: string[] = [];
  const artifact = envelope.artifact as unknown as Dict;
  const artifactValid = sha256Json(artifact) === envelope.artifact_sha256;
  if (!artifactValid) diagnostics.push('Artifact SHA-256 mismatch.');
  const { envelope_sha256: _digest, ...withoutEnvelopeDigest } = envelope as unknown as Dict;
  const envelopeValid = sha256Json(withoutEnvelopeDigest) === envelope.envelope_sha256;
  if (!envelopeValid) diagnostics.push('Envelope SHA-256 mismatch.');
  const canonicalBase = isRecord(artifact.canonical_base) ? artifact.canonical_base : null;
  if (!canonicalBase || !isRecord(canonicalBase.canonicalIntake) || !isRecord(canonicalBase.executionContext)) {
    diagnostics.push('Canonical Artifact Base is malformed.');
    return { result: rejected(diagnostics), capability: null };
  }
  const mode = String(canonicalBase.executionContext.mode ?? '') as ExecutionMode;
  if (!['interactive', 'batch', 'ci', 'agent'].includes(mode)) diagnostics.push('Canonical execution mode is invalid.');
  let completed: CompletedRuntimeAssessment | null = null;
  let identity = null as ReturnType<typeof deriveCanonicalPromptIdentity> | null;
  try {
    const canonicalEnvelope = rehydrateEnvelope(canonicalBase.canonicalIntake as Dict, config);
    const plan = compileRuntimePlan(canonicalEnvelope, config);
    const generationPlan = plan.generationPlan as unknown as Dict;
    if (generationPlan.plan_version !== 'generation-plan.v3' || !delegatedTargetFromPlan(plan)) {
      throw new Error('Runtime Artifact v2 must reconstruct one delegated Generation Plan v3.');
    }
    identity = deriveCanonicalPromptIdentity(plan);
    const observedIdentity = artifact.canonical_prompt_identity;
    if (canonicalJson(observedIdentity) !== canonicalJson(identity)) diagnostics.push('Canonical Prompt identity differs from Runtime recomputation.');
    const sources = sourceDiagnostics(plan.governingSources, artifact.governing_sources);
    diagnostics.push(...sources.diagnostics);
    unavailable.push(...sources.unavailable);
    const expectedSourcePaths = canonicalExpectedSourcePaths(plan, identity, config);
    if (canonicalJson(expectedSourcePaths) !== canonicalJson(plan.governingSources.map((source) => source.path).sort())) {
      diagnostics.push('Canonical expected source paths differ from the Generation Plan source inventory.');
    }
    const canonicalLegacy = renderThroughStagedLegacy(plan, mode, config);
    const renderedPrompt = enforceConstraints(String(canonicalLegacy.rendered_prompt ?? ''), plan);
    if (artifact.rendered_prompt !== renderedPrompt) diagnostics.push('Rendered Prompt differs from canonical Runtime recomputation.');
    const checkout = currentCheckoutIdentity();
    completed = completeRuntimeAssessmentInternal({
      plan,
      renderedPrompt,
      checkoutIdentity: checkout,
      reviewReceipt: envelope.authorization.review_receipt,
      artifactSha256: envelope.artifact_sha256,
      integrity: {
        artifact_valid: artifactValid,
        envelope_valid: envelopeValid,
        governing_sources_valid: diagnostics.length === 0 && unavailable.length === 0,
      },
      config,
    });
    const derived = buildCanonicalDerivedProjection(completed);
    const compatibility = projectLegacyArtifactFields(derived);
    const base = buildCanonicalArtifactBase(canonicalEnvelope, mode);
    const identityProjection = identityCompatibilityProjection(base, identity);
    const observedRuntime = isRecord(artifact.runtime) ? artifact.runtime : {};
    const expectedArtifact: Dict = {
      ...identityProjection,
      generated_at: artifact.generated_at,
      rendered_prompt: renderedPrompt,
      canonical_base: base,
      canonical_prompt_identity: identity,
      canonical_intake: base.canonicalIntake,
      derived_projection: derived,
      delegation_provenance: delegationProvenance(plan),
      ...compatibility,
      runtime: {
        node_version: String(observedRuntime.node_version ?? process.version),
        package_manager: observedRuntime.package_manager ?? null,
        pipeline_version: observedRuntime.pipeline_version ?? config.version ?? null,
        ...compatibility.runtime,
      },
      hashes: buildArtifactHashes(base.canonicalIntake, renderedPrompt, derived),
    };
    if (canonicalJson(artifact) !== canonicalJson(expectedArtifact)) diagnostics.push('Persisted Runtime Artifact v2 differs from canonical recomputation.');
    const expectedAuthorization = {
      authority_state: completed.authorityDecision.authority_state,
      downstream_use_allowed: completed.authorityDecision.downstream_use_allowed,
      review_required: completed.authorityDecision.review_required,
      review_receipt: envelope.authorization.review_receipt,
      diagnostics: completed.authorityDecision.diagnostics,
    };
    if (canonicalJson(envelope.authorization) !== canonicalJson(expectedAuthorization)) diagnostics.push('Authorization differs from the canonical authority reducer.');
  } catch (error) {
    diagnostics.push(`Canonical Runtime v2 recomputation failed: ${(error as Error).message}`);
  }
  const verificationStatus = diagnostics.length > 0 ? 'rejected' : unavailable.length > 0 ? 'insufficient_evidence' : 'verified';
  const result: VerificationResult = {
    verification_status: verificationStatus,
    integrity_valid: diagnostics.length === 0 && unavailable.length === 0,
    semantic_derivation_valid: completed !== null && diagnostics.length === 0,
    authority_consistent: completed !== null && diagnostics.length === 0,
    artifact_sha256: envelope.artifact_sha256,
    authority_state: authorityState(envelope.authorization.authority_state),
    downstream_use_allowed: verificationStatus === 'verified' && envelope.authorization.downstream_use_allowed === true,
    checks: completed ? [...completed.validationLedger] as ValidationCheckRecord[] : [],
    diagnostics: [...diagnostics, ...unavailable],
  };
  const capability = verificationStatus === 'verified' && completed && identity
    ? { verificationResult: result, completedAssessment: completed, artifactEnvelope: envelope, canonicalPromptIdentity: identity }
    : null;
  return { result, capability };
}

export function verifyRuntimeArtifact(path: string, configOverride?: PEaCConfig): VerificationResult {
  const config = configOverride ?? loadConfig();
  if (rawSchemaVersion(path) !== 'runtime-artifact-envelope.v2') return verifyArtifactV1(path, config);
  try {
    return verifyV2Detailed(path, config).result;
  } catch (error) {
    return rejected([`Verification failed closed: ${(error as Error).message}`]);
  }
}

/** @internal Official review API only. */
export function verifyRuntimeArtifactForReviewInternal(
  path: string,
  configOverride?: PEaCConfig,
): VerifiedRuntimeCompletionInternal {
  const config = configOverride ?? loadConfig();
  if (rawSchemaVersion(path) !== 'runtime-artifact-envelope.v2') return verifyArtifactForReviewV1(path, config);
  const detailed = verifyV2Detailed(path, config);
  if (!detailed.capability) throw new Error(`Cannot review an unverified Runtime Artifact v2: ${detailed.result.diagnostics.join('; ')}`);
  return detailed.capability;
}
