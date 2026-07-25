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

const SOURCE_INDEPENDENT_RELATIONSHIPS = [
  'canonical_intake_base',
  'execution_context_projection',
  'prompt_identity_projection',
  'identity_derived_links',
  'canonical_intake_derived_links',
  'generation_plan_mirror',
  'validation_ledger_mirror',
  'compatibility_validation_mirror',
  'domain_subtype_mirrors',
  'provenance_mirror',
  'policies_mirror',
  'risk_review_mirrors',
  'assurance_context_mirrors',
  'governing_source_mirrors',
  'runtime_checkout_mirror',
  'authorization_cross_fields',
] as const;

type SourceIndependentRelationship = typeof SOURCE_INDEPENDENT_RELATIONSHIPS[number];

interface SourceIndependentContext {
  envelope: RuntimeArtifactEnvelope;
  artifact: Dict;
  authorization: Dict;
  base: CanonicalArtifactBase | null;
  identity: CanonicalPromptIdentity | null;
  derived: Dict | null;
}

function derivedRecord(ctx: SourceIndependentContext, key: string): Dict | null {
  const value = ctx.derived?.[key];
  return isRecord(value) ? value : null;
}

function collectAuthorizationCrossFields(ctx: SourceIndependentContext, facts: VerificationFacts): void {
  const state = authorityState(ctx.authorization.authority_state);
  if (!state) facts.schemaContradictions.push('Authorization authority_state is invalid.');
  if (typeof ctx.authorization.downstream_use_allowed !== 'boolean') facts.schemaContradictions.push('Authorization downstream_use_allowed must be boolean.');
  if (typeof ctx.authorization.review_required !== 'boolean') facts.schemaContradictions.push('Authorization review_required must be boolean.');

  const downstreamAllowed = ctx.authorization.downstream_use_allowed === true;
  const reviewRequired = ctx.authorization.review_required === true;
  const receipt = ctx.authorization.review_receipt;

  compareInto(
    'authorization review_required compatibility mirror',
    ctx.authorization.review_required,
    ctx.artifact.requires_human_review,
    facts.authorityContradictions,
  );

  if (state === 'review_pending' && (!reviewRequired || downstreamAllowed || receipt !== null)) {
    facts.authorityContradictions.push('review_pending cross-field invariant failed.');
  }
  if ((state === 'rejected' || state === 'non_authoritative_fixture') && downstreamAllowed) {
    facts.authorityContradictions.push(`${state} cannot allow downstream use.`);
  }
  if (state === 'authorized' && !downstreamAllowed) {
    facts.authorityContradictions.push('authorized state must allow downstream use.');
  }
  if (state === 'authorized' && reviewRequired) {
    if (!isRecord(receipt)
      || receipt.decision !== 'approved'
      || receipt.artifact_sha256 !== ctx.envelope.artifact_sha256) {
      facts.authorityContradictions.push('Reviewed authorization lacks an exact approved Artifact-bound receipt.');
    }
  }
  if (state === 'authorized' && !reviewRequired && receipt !== null) {
    facts.authorityContradictions.push('Automatic authorization cannot carry a review receipt.');
  }
  if (isRecord(receipt) && receipt.artifact_sha256 !== ctx.envelope.artifact_sha256) {
    facts.authorityContradictions.push('Review receipt is not bound to the exact Artifact SHA-256.');
  }
}

function collectSourceIndependentRelationship(
  relationship: SourceIndependentRelationship,
  ctx: SourceIndependentContext,
  facts: VerificationFacts,
): void {
  switch (relationship) {
    case 'canonical_intake_base':
      if (ctx.base) compareInto('canonical intake compatibility mirror', ctx.artifact.canonical_intake, ctx.base.canonicalIntake, facts.semanticContradictions);
      return;
    case 'execution_context_projection':
      if (ctx.base) compareInto('execution_mode compatibility mirror', ctx.artifact.execution_mode, ctx.base.executionContext.mode, facts.semanticContradictions);
      return;
    case 'prompt_identity_projection':
      if (ctx.identity) compareInto('prompt_id compatibility mirror', ctx.artifact.prompt_id, ctx.identity.promptId, facts.semanticContradictions);
      return;
    case 'identity_derived_links': {
      if (!ctx.identity || !ctx.derived) return;
      const provenance = derivedRecord(ctx, 'provenance');
      compareInto('Prompt identity domain mirror', ctx.identity.domain, ctx.derived.domain, facts.semanticContradictions);
      compareInto('Prompt identity subtype mirror', ctx.identity.subtype, ctx.derived.subtype, facts.semanticContradictions);
      if (provenance) {
        compareInto('Prompt identity template path mirror', ctx.identity.templatePath, provenance.template_used, facts.semanticContradictions);
        compareInto('Prompt identity template version mirror', ctx.identity.templateVersion, provenance.template_version, facts.semanticContradictions);
      }
      return;
    }
    case 'canonical_intake_derived_links': {
      if (!ctx.base || !ctx.derived) return;
      const provenance = derivedRecord(ctx, 'provenance');
      const generationPlan = derivedRecord(ctx, 'generationPlan');
      const intake = generationPlan && isRecord(generationPlan.intake) ? generationPlan.intake : null;
      if (provenance) compareInto('canonical intake provenance digest mirror', ctx.base.canonicalIntake.intake_digest, provenance.canonical_intake_digest, facts.semanticContradictions);
      if (intake) compareInto('canonical intake Generation Plan digest mirror', ctx.base.canonicalIntake.intake_digest, intake.digest, facts.semanticContradictions);
      return;
    }
    case 'generation_plan_mirror':
      if (ctx.derived) compareInto('generation plan compatibility mirror', ctx.artifact.generation_plan, ctx.derived.generationPlan, facts.semanticContradictions);
      return;
    case 'validation_ledger_mirror': {
      if (!ctx.derived) return;
      const ledger = isRecord(ctx.artifact.validation_ledger) ? ctx.artifact.validation_ledger : null;
      if (!ledger) facts.schemaContradictions.push('Legacy validation_ledger compatibility projection is malformed.');
      else compareInto('validation ledger compatibility mirror', ledger.checks, ctx.derived.validationLedger, facts.semanticContradictions);
      return;
    }
    case 'compatibility_validation_mirror':
      if (ctx.derived) compareInto('validation compatibility mirror', ctx.artifact.validation, ctx.derived.compatibilityValidation, facts.semanticContradictions);
      return;
    case 'domain_subtype_mirrors':
      if (ctx.derived) {
        compareInto('domain compatibility mirror', ctx.artifact.domain, ctx.derived.domain, facts.semanticContradictions);
        compareInto('subtype compatibility mirror', ctx.artifact.subtype, ctx.derived.subtype, facts.semanticContradictions);
      }
      return;
    case 'provenance_mirror':
      if (ctx.derived) compareInto('provenance compatibility mirror', ctx.artifact.provenance, ctx.derived.provenance, facts.semanticContradictions);
      return;
    case 'policies_mirror':
      if (ctx.derived) compareInto('policies compatibility mirror', ctx.artifact.policies_applied, ctx.derived.policiesApplied, facts.semanticContradictions);
      return;
    case 'risk_review_mirrors':
      if (ctx.derived) {
        compareInto('risk_level compatibility mirror', ctx.artifact.risk_level, ctx.derived.legacyRiskLevel, facts.semanticContradictions);
        compareInto('requires_human_review compatibility mirror', ctx.artifact.requires_human_review, ctx.derived.requiresHumanReview, facts.semanticContradictions);
        compareInto('review_reason compatibility mirror', ctx.artifact.review_reason, ctx.derived.reviewReason, facts.semanticContradictions);
      }
      return;
    case 'assurance_context_mirrors':
      if (ctx.derived) {
        compareInto('assurance compatibility mirror', ctx.artifact.assurance, ctx.derived.assurance, facts.semanticContradictions);
        compareInto('context attribution compatibility mirror', ctx.artifact.context_attribution, ctx.derived.contextAttribution, facts.semanticContradictions);
      }
      return;
    case 'governing_source_mirrors': {
      if (!ctx.derived) return;
      compareInto('governing sources compatibility mirror', ctx.artifact.governing_sources, ctx.derived.governingSources, facts.semanticContradictions);
      const sourceHashes = derivedRecord(ctx, 'sourceHashes');
      if (!sourceHashes) facts.schemaContradictions.push('Canonical sourceHashes projection is malformed.');
      else compareInto('governing source hash mirror', sourceHashes.sources, ctx.derived.governingSources, facts.semanticContradictions);
      return;
    }
    case 'runtime_checkout_mirror': {
      if (!ctx.derived) return;
      const runtime = isRecord(ctx.artifact.runtime) ? ctx.artifact.runtime : null;
      const provenance = derivedRecord(ctx, 'provenance');
      const checkout = provenance && isRecord(provenance.checkout) ? provenance.checkout : null;
      if (!runtime || !checkout) {
        facts.schemaContradictions.push('Runtime checkout compatibility projection is malformed.');
        return;
      }
      compareInto('runtime actual checkout SHA mirror', runtime.git_commit_sha, checkout.actual_sha, facts.semanticContradictions);
      compareInto('runtime expected checkout SHA mirror', runtime.expected_tested_sha, checkout.expected_sha, facts.semanticContradictions);
      compareInto('runtime checkout source mirror', runtime.provenance_source, checkout.source, facts.semanticContradictions);
      return;
    }
    case 'authorization_cross_fields':
      collectAuthorizationCrossFields(ctx, facts);
      return;
    default: {
      const exhaustive: never = relationship;
      throw new Error(`Unhandled source-independent relationship: ${String(exhaustive)}`);
    }
  }
}

function collectSourceIndependentFacts(
  envelope: RuntimeArtifactEnvelope,
  base: CanonicalArtifactBase | null,
  identity: CanonicalPromptIdentity | null,
  facts: VerificationFacts,
): void {
  const artifact = envelope.artifact as unknown as Dict;
  const authorization = envelope.authorization as unknown as Dict;
  const derived = isRecord(artifact.derived_projection) ? artifact.derived_projection : null;
  if (!derived) facts.schemaContradictions.push('Canonical derived_projection must be an object.');
  const context: SourceIndependentContext = { envelope, artifact, authorization, base, identity, derived };
  for (const relationship of SOURCE_INDEPENDENT_RELATIONSHIPS) {
    collectSourceIndependentRelationship(relationship, context, facts);
  }
}

function collectCompletedAuthorityFacts(
  envelope: RuntimeArtifactEnvelope,
  completed: CompletedRuntimeAssessment,
  facts: VerificationFacts,
): void {
  const authorization = envelope.authorization;
  if (completed.validationLedger.length === 0) facts.authorityContradictions.push('Authorized state cannot exist without a non-empty completed validation ledger.');
  if (
    authorization.authority_state === 'authorized'
    && completed.validationLedger.some((item) => item.applicable && item.blocking && (!item.executed || item.passed !== true))
  ) facts.authorityContradictions.push('Authorized state has an unsatisfied blocking Check.');
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

  // Phase A: source-independent persisted contradictions always execute.
  collectSourceIndependentFacts(envelope, base, persistedIdentity, facts);

  let completed: CompletedRuntimeAssessment | null = null;
  let rebuiltIdentity: CanonicalPromptIdentity | null = null;
  let canonicalEvidenceAvailable = true;

  // Phase B: canonical source-dependent reconstruction and recomputation.
  if (base) {
    try {
      const canonicalEnvelope = rehydrateEnvelope(base.canonicalIntake as unknown as Dict, config);
      const plan = compileRuntimePlan(canonicalEnvelope, config);
      rebuiltIdentity = deriveCanonicalPromptIdentity(plan);
      if (persistedIdentity) compareInto('canonical Prompt identity', persistedIdentity, rebuiltIdentity, facts.semanticContradictions);
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
        const actualLegacy = extractLegacyArtifactFields(artifact as unknown as Dict);
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
        collectCompletedAuthorityFacts(envelope, completed, facts);
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
