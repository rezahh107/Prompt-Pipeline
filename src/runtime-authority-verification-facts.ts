import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Dict, ExecutionMode, PEaCConfig } from './peac.js';
import { loadConfig } from './peac.js';
import {
  type AuthorityState,
  type CanonicalDerivedProjection,
  type CompletedRuntimeAssessment,
  type GoverningSource,
  type RuntimeArtifactEnvelope,
  type ValidationCheckRecord,
  type VerificationResult,
  type VerificationStatus,
  canonicalJson,
  formatAjvErrors,
  parseDataFile,
  rehydrateEnvelope,
  sha256File,
  sha256Json,
} from './runtime-authority-foundation.js';
import { compileRuntimePlan } from './runtime-authority-payload-policy.js';
import {
  buildCanonicalArtifactBase,
  buildArtifactHashes,
  canonicalExpectedSourcePaths,
  compareCanonical,
  deriveCanonicalPromptIdentity,
  extractLegacyArtifactFields,
  identityCompatibilityProjection,
  isRecord,
  projectLegacyArtifactFields,
  type CanonicalArtifactBase,
  type CanonicalPromptIdentity,
  type PersistedCanonicalIntake,
} from './runtime-authority-canonical-artifact.js';
import {
  completeRuntimeAssessmentInternal,
  currentCheckoutIdentity,
  enforceConstraints,
  renderThroughStagedLegacy,
} from './runtime-authority-execution.js';
import { buildCanonicalDerivedProjection } from './runtime-authority-artifact.js';

export interface SafeEnvelopeParseResult {
  envelope: RuntimeArtifactEnvelope | null;
  structuralDiagnostics: string[];
}

export interface VerificationFacts {
  schemaContradictions: string[];
  integrityContradictions: string[];
  semanticContradictions: string[];
  authorityContradictions: string[];
  canonicalEvidenceUnavailable: string[];
}

interface SafeCanonicalBaseResult {
  base: CanonicalArtifactBase | null;
  diagnostics: string[];
}

interface SafeCanonicalIdentityResult {
  identity: CanonicalPromptIdentity | null;
  diagnostics: string[];
}

export interface VerifiedRuntimeCompletionInternal {
  verificationResult: VerificationResult;
  completedAssessment: CompletedRuntimeAssessment;
  artifactEnvelope: RuntimeArtifactEnvelope;
  canonicalPromptIdentity: CanonicalPromptIdentity;
}

const EXECUTION_MODES = new Set<ExecutionMode>(['interactive', 'batch', 'ci', 'agent']);

export function reduceVerificationOutcome(facts: VerificationFacts): VerificationStatus {
  if (
    facts.schemaContradictions.length > 0
    || facts.integrityContradictions.length > 0
    || facts.semanticContradictions.length > 0
    || facts.authorityContradictions.length > 0
  ) return 'rejected';
  if (facts.canonicalEvidenceUnavailable.length > 0) return 'insufficient_evidence';
  return 'verified';
}

function emptyFacts(): VerificationFacts {
  return {
    schemaContradictions: [],
    integrityContradictions: [],
    semanticContradictions: [],
    authorityContradictions: [],
    canonicalEvidenceUnavailable: [],
  };
}

function allDiagnostics(facts: VerificationFacts): string[] {
  return [
    ...facts.schemaContradictions,
    ...facts.integrityContradictions,
    ...facts.semanticContradictions,
    ...facts.authorityContradictions,
    ...facts.canonicalEvidenceUnavailable,
  ];
}

export function safeParseEnvelope(path: string): SafeEnvelopeParseResult {
  const structuralDiagnostics: string[] = [];
  let value: unknown;
  try {
    value = parseDataFile(path);
  } catch (error) {
    return { envelope: null, structuralDiagnostics: [`Artifact parse failed: ${(error as Error).message}`] };
  }
  if (!isRecord(value)) return { envelope: null, structuralDiagnostics: ['Artifact envelope must be an object.'] };
  if (!isRecord(value.artifact)) structuralDiagnostics.push('Artifact envelope.artifact must be an object.');
  if (!isRecord(value.authorization)) structuralDiagnostics.push('Artifact envelope.authorization must be an object.');
  if (typeof value.artifact_sha256 !== 'string') structuralDiagnostics.push('Artifact envelope.artifact_sha256 must be a string.');
  if (typeof value.envelope_sha256 !== 'string') structuralDiagnostics.push('Artifact envelope.envelope_sha256 must be a string.');
  if (structuralDiagnostics.length > 0) return { envelope: null, structuralDiagnostics };
  return { envelope: value as unknown as RuntimeArtifactEnvelope, structuralDiagnostics };
}

function schemaDiagnostics(envelope: RuntimeArtifactEnvelope, config: PEaCConfig): string[] {
  const schemaPath = join(config.pipeline_path, 'runtime-artifact.schema.json');
  if (!existsSync(schemaPath)) return [`Runtime Artifact schema is unavailable: ${schemaPath}`];
  try {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    return validate(envelope) ? [] : formatAjvErrors(validate.errors).map((item) => `Schema contradiction: ${item}`);
  } catch (error) {
    return [`Runtime Artifact schema evaluation failed: ${(error as Error).message}`];
  }
}

function safeCanonicalIntake(value: unknown): PersistedCanonicalIntake | null {
  if (!isRecord(value)) return null;
  if (value.schema_id !== 'peac.validated-intake' || value.schema_version !== 'validated-intake.v1') return null;
  if (typeof value.intake_digest !== 'string' || typeof value.raw_request_digest !== 'string') return null;
  if (!['interactive_request', 'api_request', 'fixture_validation'].includes(String(value.source_mode))) return null;
  if (!isRecord(value.normalized_inputs)) return null;
  return value as unknown as PersistedCanonicalIntake;
}

function safeCanonicalBase(value: unknown): SafeCanonicalBaseResult {
  const diagnostics: string[] = [];
  if (!isRecord(value)) return { base: null, diagnostics: ['Canonical Artifact Base must be an object.'] };
  const canonicalIntake = safeCanonicalIntake(value.canonicalIntake);
  if (!canonicalIntake) diagnostics.push('Canonical Artifact Base canonicalIntake is malformed.');
  const executionContext = isRecord(value.executionContext) ? value.executionContext : null;
  const mode = executionContext?.mode;
  if (!EXECUTION_MODES.has(mode as ExecutionMode)) diagnostics.push('Canonical Artifact Base executionContext.mode is invalid.');
  if (diagnostics.length > 0 || !canonicalIntake || !executionContext) return { base: null, diagnostics };
  return {
    base: { canonicalIntake, executionContext: { mode: mode as ExecutionMode } },
    diagnostics,
  };
}

function safeCanonicalIdentity(value: unknown): SafeCanonicalIdentityResult {
  const diagnostics: string[] = [];
  if (!isRecord(value)) return { identity: null, diagnostics: ['Canonical Prompt Identity must be an object.'] };
  if (typeof value.promptId !== 'string' || value.promptId.length === 0) diagnostics.push('Canonical Prompt Identity promptId is invalid.');
  if (typeof value.domain !== 'string' || value.domain.length === 0) diagnostics.push('Canonical Prompt Identity domain is invalid.');
  if (!(value.subtype === null || typeof value.subtype === 'string')) diagnostics.push('Canonical Prompt Identity subtype is invalid.');
  if (!(value.templatePath === null || typeof value.templatePath === 'string')) diagnostics.push('Canonical Prompt Identity templatePath is invalid.');
  if (typeof value.templateVersion !== 'string' || value.templateVersion.length === 0) diagnostics.push('Canonical Prompt Identity templateVersion is invalid.');
  if (diagnostics.length > 0) return { identity: null, diagnostics };
  return { identity: value as unknown as CanonicalPromptIdentity, diagnostics };
}

function sourceRecords(value: unknown): GoverningSource[] | null {
  if (!Array.isArray(value)) return null;
  const records: GoverningSource[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.algorithm !== 'sha256' || typeof item.path !== 'string' || typeof item.sha256 !== 'string') return null;
    records.push({ algorithm: 'sha256', path: item.path, sha256: item.sha256 });
  }
  return records;
}

function compareSourceInventory(
  expectedPaths: readonly string[],
  persistedSources: GoverningSource[],
  facts: VerificationFacts,
): boolean {
  const expected = [...new Set(expectedPaths)].sort();
  const persisted = [...new Set(persistedSources.map((source) => source.path))].sort();
  if (canonicalJson(expected) !== canonicalJson(persisted)) {
    facts.semanticContradictions.push('Canonical governing source-set differs from the persisted source inventory.');
  }
  const byPath = new Map(persistedSources.map((source) => [source.path, source]));
  let allAvailable = true;
  for (const path of expected) {
    const persistedSource = byPath.get(path);
    if (!persistedSource) continue;
    if (!existsSync(path)) {
      allAvailable = false;
      facts.canonicalEvidenceUnavailable.push(`Canonical expected governing source is unavailable: ${path}`);
      continue;
    }
    const observed = sha256File(path);
    if (observed !== persistedSource.sha256) facts.integrityContradictions.push(`Canonical governing source hash differs: ${path}`);
  }
  return allAvailable;
}

function compareInto(label: string, actual: unknown, expected: unknown, target: string[]): void {
  compareCanonical(label, actual, expected, target);
}

function authorityState(value: unknown): AuthorityState | null {
  return ['authorized', 'review_pending', 'rejected', 'non_authoritative_fixture'].includes(String(value))
    ? value as AuthorityState
    : null;
}

function baseRejectedResult(diagnostics: string[]): VerificationResult {
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

function crossFieldFacts(
  envelope: RuntimeArtifactEnvelope,
  completed: CompletedRuntimeAssessment,
  facts: VerificationFacts,
): void {
  const authorization = envelope.authorization;
  const derived = isRecord(envelope.artifact.derived_projection)
    ? envelope.artifact.derived_projection as unknown as CanonicalDerivedProjection
    : null;
  if (completed.validationLedger.length === 0) facts.authorityContradictions.push('Authorized state cannot exist without a non-empty completed validation ledger.');
  if (
    authorization.authority_state === 'authorized'
    && completed.validationLedger.some((item) => item.applicable && item.blocking && (!item.executed || item.passed !== true))
  ) facts.authorityContradictions.push('Authorized state has an unsatisfied blocking Check.');
  if (
    authorization.authority_state === 'review_pending'
    && (!authorization.review_required || authorization.downstream_use_allowed || authorization.review_receipt !== null)
  ) facts.authorityContradictions.push('review_pending cross-field invariant failed.');
  if (
    authorization.authority_state === 'authorized'
    && authorization.review_required
    && (!authorization.review_receipt
      || authorization.review_receipt.decision !== 'approved'
      || authorization.review_receipt.artifact_sha256 !== envelope.artifact_sha256)
  ) facts.authorityContradictions.push('Reviewed authorization lacks an exact approved Artifact-bound receipt.');
  if (derived && envelope.artifact.requires_human_review !== derived.risk.review_required) {
    facts.semanticContradictions.push('Legacy requires_human_review contradicts canonical risk.review_required.');
  }
  const canonicalRisk = derived?.risk.classification;
  const expectedLegacyRisk = canonicalRisk === 'low' ? 'low' : canonicalRisk === 'medium' ? 'medium' : 'high';
  if (derived && envelope.artifact.risk_level !== expectedLegacyRisk) {
    facts.semanticContradictions.push('Legacy risk_level contradicts canonical risk classification.');
  }
}

function verifyArtifactDetailed(
  path: string,
  config: PEaCConfig,
): { result: VerificationResult; capability: VerifiedRuntimeCompletionInternal | null } {
  const parsed = safeParseEnvelope(path);
  if (!parsed.envelope) return { result: baseRejectedResult(parsed.structuralDiagnostics), capability: null };
  const envelope = parsed.envelope;
  const facts = emptyFacts();
  facts.schemaContradictions.push(...schemaDiagnostics(envelope, config));

  const artifact = envelope.artifact;
  const artifactValid = sha256Json(artifact) === envelope.artifact_sha256;
  if (!artifactValid) facts.integrityContradictions.push('Artifact SHA-256 mismatch.');
  const { envelope_sha256: _ignored, ...withoutEnvelopeDigest } = envelope;
  const envelopeValid = sha256Json(withoutEnvelopeDigest) === envelope.envelope_sha256;
  if (!envelopeValid) facts.integrityContradictions.push('Envelope SHA-256 mismatch.');

  const baseResult = safeCanonicalBase(artifact.canonical_base);
  facts.schemaContradictions.push(...baseResult.diagnostics);
  const identityResult = safeCanonicalIdentity(artifact.canonical_prompt_identity);
  facts.schemaContradictions.push(...identityResult.diagnostics);
  const base = baseResult.base;
  const persistedIdentity = identityResult.identity;

  if (base) {
    compareInto('canonical intake compatibility projection', artifact.canonical_intake, base.canonicalIntake, facts.semanticContradictions);
    compareInto('execution_mode compatibility projection', artifact.execution_mode, base.executionContext.mode, facts.semanticContradictions);
  }
  if (persistedIdentity) compareInto('prompt_id compatibility projection', artifact.prompt_id, persistedIdentity.promptId, facts.semanticContradictions);

  let completed: CompletedRuntimeAssessment | null = null;
  let rebuiltIdentity: CanonicalPromptIdentity | null = null;
  let canonicalEvidenceAvailable = true;
  if (base) {
    try {
      const canonicalEnvelope = rehydrateEnvelope(base.canonicalIntake as unknown as Dict, config);
      const plan = compileRuntimePlan(canonicalEnvelope, config);
      rebuiltIdentity = deriveCanonicalPromptIdentity(plan);
      if (persistedIdentity) compareInto('canonical Prompt identity', persistedIdentity, rebuiltIdentity, facts.semanticContradictions);
      compareInto('canonical Artifact Base', artifact.canonical_base, buildCanonicalArtifactBase(canonicalEnvelope, base.executionContext.mode), facts.semanticContradictions);
      const projectedIdentity = identityCompatibilityProjection(buildCanonicalArtifactBase(canonicalEnvelope, base.executionContext.mode), rebuiltIdentity);
      compareInto('identity compatibility projection', { prompt_id: artifact.prompt_id, execution_mode: artifact.execution_mode }, projectedIdentity, facts.semanticContradictions);

      const persistedSources = sourceRecords(artifact.governing_sources);
      if (!persistedSources || persistedSources.length === 0) {
        facts.schemaContradictions.push('Persisted governing_sources is malformed or empty.');
        canonicalEvidenceAvailable = false;
      } else {
        canonicalEvidenceAvailable = compareSourceInventory(
          canonicalExpectedSourcePaths(plan, rebuiltIdentity, config),
          persistedSources,
          facts,
        );
      }

      if (canonicalEvidenceAvailable) {
        const canonicalLegacy = renderThroughStagedLegacy(plan, base.executionContext.mode, config);
        const expectedRenderedPrompt = enforceConstraints(String(canonicalLegacy.rendered_prompt ?? ''), plan);
        compareInto('rendered Prompt', artifact.rendered_prompt, expectedRenderedPrompt, facts.semanticContradictions);
        const checkout = currentCheckoutIdentity();
        completed = completeRuntimeAssessmentInternal({
          plan,
          renderedPrompt: expectedRenderedPrompt,
          checkoutIdentity: checkout,
          reviewReceipt: envelope.authorization.review_receipt,
          artifactSha256: envelope.artifact_sha256,
          integrity: {
            artifact_valid: artifactValid,
            envelope_valid: envelopeValid,
            governing_sources_valid: facts.integrityContradictions.length === 0,
          },
          config,
        });
        const expectedDerived = buildCanonicalDerivedProjection(completed);
        compareInto('canonical derived projection', artifact.derived_projection, expectedDerived, facts.semanticContradictions);
        const expectedLegacy = projectLegacyArtifactFields(expectedDerived);
        const actualLegacy = extractLegacyArtifactFields(artifact);
        if (!actualLegacy) facts.schemaContradictions.push('Legacy compatibility projection is malformed.');
        else compareInto('legacy compatibility projection', actualLegacy, expectedLegacy, facts.semanticContradictions);
        const expectedHashes = buildArtifactHashes(base.canonicalIntake, expectedRenderedPrompt, expectedDerived);
        compareInto('Artifact hashes', artifact.hashes, expectedHashes, facts.semanticContradictions);
        const expectedAuthorization = {
          authority_state: completed.authorityDecision.authority_state,
          downstream_use_allowed: completed.authorityDecision.downstream_use_allowed,
          review_required: completed.authorityDecision.review_required,
          review_receipt: envelope.authorization.review_receipt,
          diagnostics: completed.authorityDecision.diagnostics,
        };
        compareInto('authorization', envelope.authorization, expectedAuthorization, facts.authorityContradictions);
        crossFieldFacts(envelope, completed, facts);
      }
    } catch (error) {
      if (facts.canonicalEvidenceUnavailable.length === 0) {
        facts.semanticContradictions.push(`Canonical semantic recomputation failed: ${(error as Error).message}`);
      }
    }
  }

  const verificationStatus = reduceVerificationOutcome(facts);
  const result: VerificationResult = {
    verification_status: verificationStatus,
    integrity_valid: facts.schemaContradictions.length === 0
      && facts.integrityContradictions.length === 0
      && facts.canonicalEvidenceUnavailable.length === 0,
    semantic_derivation_valid: completed !== null
      && facts.schemaContradictions.length === 0
      && facts.semanticContradictions.length === 0,
    authority_consistent: completed !== null
      && facts.schemaContradictions.length === 0
      && facts.authorityContradictions.length === 0,
    artifact_sha256: typeof envelope.artifact_sha256 === 'string' ? envelope.artifact_sha256 : null,
    authority_state: authorityState(envelope.authorization.authority_state),
    downstream_use_allowed: verificationStatus === 'verified' && envelope.authorization.downstream_use_allowed === true,
    checks: completed ? [...completed.validationLedger] as ValidationCheckRecord[] : [],
    diagnostics: allDiagnostics(facts),
  };
  const capability = verificationStatus === 'verified' && completed && rebuiltIdentity
    ? { verificationResult: result, completedAssessment: completed, artifactEnvelope: envelope, canonicalPromptIdentity: rebuiltIdentity }
    : null;
  return { result, capability };
}

export function verifyArtifact(path: string, configOverride?: PEaCConfig): VerificationResult {
  const config = configOverride ?? loadConfig();
  try {
    return verifyArtifactDetailed(path, config).result;
  } catch (error) {
    return baseRejectedResult([`Verification failed closed: ${(error as Error).message}`]);
  }
}

/** @internal Official review API only. */
export function verifyArtifactForReviewInternal(
  path: string,
  configOverride?: PEaCConfig,
): VerifiedRuntimeCompletionInternal {
  const config = configOverride ?? loadConfig();
  const detailed = verifyArtifactDetailed(path, config);
  if (!detailed.capability) throw new Error(`Cannot review an unverified Artifact: ${detailed.result.diagnostics.join('; ')}`);
  return detailed.capability;
}
