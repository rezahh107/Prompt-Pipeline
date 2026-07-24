import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';
import { loadConfig, type Dict, type ExecutionMode, type PEaCConfig } from './peac.js';
import {
  type AuthorityState,
  type DerivedRisk,
  type GenerationPlan,
  type GoverningSource,
  type RuntimeArtifactEnvelope,
  type RuntimeAssessment,
  type ValidatedIntakeEnvelope,
  type ValidationCheckRecord,
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
import { compileGenerationPlan, governingSources } from './runtime-authority-plan.js';
import {
  currentCheckoutIdentity,
  deriveAuthorityDecision,
  deriveRuntimeAssessment,
  enforceConstraints,
  legacyValidationProjection,
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

export function generateArtifact(
  envelope: ValidatedIntakeEnvelope,
  mode: ExecutionMode = 'batch',
  configOverride?: PEaCConfig,
): { artifact: RuntimeArtifactEnvelope; outputPath: string } {
  assertValidatedEnvelope(envelope);
  const config = configOverride ?? loadConfig();
  const plan = compileGenerationPlan(envelope, config);
  const legacyArtifact = renderThroughStagedLegacy(plan, mode, config);
  const renderedPrompt = enforceConstraints(String(legacyArtifact.rendered_prompt ?? ''), plan);
  const checkout = currentCheckoutIdentity();
  const assessment = deriveRuntimeAssessment({
    validatedIntake: envelope,
    config,
    renderedPrompt,
    legacyArtifact,
    checkoutIdentity: checkout,
    reviewReceipt: null,
    artifactSha256: null,
    integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true },
  });
  const sources = governingSources(assessment.generationPlan, config);
  const compatibilityValidation = legacyValidationProjection(assessment.validationLedger, config, assessment.routing.domain);
  const artifactPayload: Dict = {
    ...legacyArtifact,
    generated_at: new Date().toISOString(),
    rendered_prompt: renderedPrompt,
    validation: compatibilityValidation,
    risk_level: legacyRisk(assessment.risk.classification),
    requires_human_review: assessment.risk.review_required,
    review_reason: assessment.risk.review_required ? assessment.risk.decision : null,
    canonical_intake: {
      schema_id: envelope.schema_id,
      schema_version: envelope.schema_version,
      intake_digest: envelope.intake_digest,
      raw_request_digest: envelope.raw_request_digest,
      source_mode: envelope.source_mode,
      normalized_inputs: envelope.normalized_inputs,
    },
    generation_plan: assessment.generationPlan,
    validation_ledger: { checks: assessment.validationLedger },
    runtime: {
      ...((legacyArtifact.runtime as Dict | undefined) ?? {}),
      git_commit_sha: checkout.actual_sha,
      expected_tested_sha: checkout.expected_sha,
      provenance_source: checkout.source,
    },
    assurance: {
      profile: assessment.generationPlan.evaluation.profile,
      validation_kind: 'static_prompt_and_metadata_only',
      target_model_executed: false,
      behavioral_success_observed: false,
      semantic_correctness_claimed: false,
    },
    context_attribution: { state: assessment.context.attribution_state, items: assessment.context.items },
    governing_sources: sources,
    hashes: {
      ...((legacyArtifact.hashes as Dict | undefined) ?? {}),
      rendered_prompt_hash: sha256Text(renderedPrompt),
      normalized_inputs_hash: sha256Json(envelope.normalized_inputs),
      generation_plan_hash: sha256Json(assessment.generationPlan),
      validation_ledger_hash: sha256Json(assessment.validationLedger),
    },
  };
  const artifactSha = sha256Json(artifactPayload);
  const finalDecision = deriveAuthorityDecision({
    sourceMode: envelope.source_mode,
    riskAssessment: assessment.risk,
    validationLedger: assessment.validationLedger,
    checkoutIdentity: checkout,
    reviewReceipt: null,
    artifactSha256: artifactSha,
  });
  const partial: Omit<RuntimeArtifactEnvelope, 'envelope_sha256'> = {
    schema_id: 'peac.runtime-artifact-envelope',
    schema_version: 'runtime-artifact-envelope.v1',
    artifact_sha256: artifactSha,
    artifact: artifactPayload,
    authorization: {
      authority_state: finalDecision.authority_state,
      downstream_use_allowed: finalDecision.downstream_use_allowed,
      review_required: finalDecision.review_required,
      review_receipt: null,
      diagnostics: finalDecision.diagnostics,
    },
  };
  const artifact: RuntimeArtifactEnvelope = { ...partial, envelope_sha256: sha256Json(envelopeDigestInput(partial)) };
  const id = String(legacyArtifact.prompt_id ?? `${assessment.routing.domain}.default.v1`).replaceAll('.', '-');
  const outputPath = join(publicationDirectory(config, finalDecision.authority_state), `${id}-${artifact.artifact_sha256.slice(0, 16)}.yaml`);
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

function ledgerFromArtifact(artifact: Dict): ValidationCheckRecord[] {
  const value = artifact.validation_ledger;
  const checks = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Dict).checks : null;
  if (!Array.isArray(checks)) return [];
  return checks as ValidationCheckRecord[];
}

function compareSemantic(label: string, actual: unknown, expected: unknown, diagnostics: string[]): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) diagnostics.push(`${label} differs from canonical Runtime recomputation.`);
}

function exactCheckSetDiagnostics(actual: ValidationCheckRecord[], expected: ValidationCheckRecord[]): string[] {
  const diagnostics: string[] = [];
  const ids = actual.map((item) => item.check_id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) diagnostics.push(`Duplicate Check IDs: ${[...new Set(duplicates)].join(', ')}`);
  const actualSet = [...new Set(ids)].sort();
  const expectedSet = expected.map((item) => item.check_id).sort();
  const missing = expectedSet.filter((id) => !actualSet.includes(id));
  const unexpected = actualSet.filter((id) => !expectedSet.includes(id));
  if (missing.length > 0) diagnostics.push(`Missing required Check IDs: ${missing.join(', ')}`);
  if (unexpected.length > 0) diagnostics.push(`Unexpected Check IDs: ${unexpected.join(', ')}`);
  if (diagnostics.length === 0) {
    const expectedById = new Map(expected.map((item) => [item.check_id, item]));
    for (const record of actual) {
      const canonical = expectedById.get(record.check_id);
      if (canonical && canonicalJson(record) !== canonicalJson(canonical)) diagnostics.push(`Check result mismatch: ${record.check_id}`);
    }
  }
  return diagnostics;
}

export function verifyArtifact(path: string, configOverride?: PEaCConfig): VerificationResult {
  const config = configOverride ?? loadConfig();
  const diagnostics: string[] = [];
  let envelope: RuntimeArtifactEnvelope;
  try {
    envelope = loadEnvelope(path);
  } catch (error) {
    return { verification_status: 'rejected', integrity_valid: false, semantic_derivation_valid: false, authority_consistent: false, artifact_sha256: null, authority_state: null, downstream_use_allowed: false, checks: [], diagnostics: [(error as Error).message] };
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
  const hashes = artifact.hashes !== null && typeof artifact.hashes === 'object' && !Array.isArray(artifact.hashes) ? artifact.hashes as Dict : {};
  if (hashes.rendered_prompt_hash !== sha256Text(String(artifact.rendered_prompt ?? ''))) diagnostics.push('Rendered Prompt hash mismatch.');
  if (intake && hashes.normalized_inputs_hash !== sha256Json((intake.normalized_inputs as Dict | undefined) ?? {})) diagnostics.push('Normalized input hash mismatch.');
  const persistedPlan = artifact.generation_plan as GenerationPlan | undefined;
  const persistedLedger = ledgerFromArtifact(artifact);
  if (hashes.generation_plan_hash !== sha256Json(persistedPlan ?? {})) diagnostics.push('Generation plan hash mismatch.');
  if (hashes.validation_ledger_hash !== sha256Json(persistedLedger)) diagnostics.push('Validation ledger hash mismatch.');

  const persistedSources = Array.isArray(artifact.governing_sources) ? artifact.governing_sources as GoverningSource[] : [];
  const unavailableSource = persistedSources.some((source) => !source.path || !existsSync(source.path));
  const governingSourcesValid = persistedSources.length > 0 && persistedSources.every((source) => existsSync(source.path) && source.sha256 === sha256File(source.path));
  if (!governingSourcesValid) diagnostics.push('Persisted governing sources are unavailable or changed.');

  let assessment: RuntimeAssessment | null = null;
  let canonicalEnvelope: ValidatedIntakeEnvelope | null = null;
  try {
    if (!intake) throw new Error('Canonical intake is unavailable.');
    canonicalEnvelope = rehydrateEnvelope(intake, config);
    const checkout = currentCheckoutIdentity();
    assessment = deriveRuntimeAssessment({
      validatedIntake: canonicalEnvelope,
      config,
      renderedPrompt: String(artifact.rendered_prompt ?? ''),
      legacyArtifact: artifact,
      checkoutIdentity: checkout,
      reviewReceipt: envelope.authorization.review_receipt,
      artifactSha256: envelope.artifact_sha256,
      integrity: { artifact_valid: artifactValid, envelope_valid: envelopeValid, governing_sources_valid: governingSourcesValid },
    });
    const canonicalSources = governingSources(assessment.generationPlan, config);
    compareSemantic('governing_sources', persistedSources, canonicalSources, diagnostics);
    compareSemantic('generation_plan.routing', persistedPlan?.routing, assessment.routing, diagnostics);
    compareSemantic('generation_plan.risk', persistedPlan?.risk, assessment.risk, diagnostics);
    compareSemantic('generation_plan.contract', persistedPlan?.contract, assessment.contract, diagnostics);
    compareSemantic('generation_plan.policies', persistedPlan?.policies, assessment.policies, diagnostics);
    compareSemantic('generation_plan.rules', persistedPlan?.rules, assessment.rules, diagnostics);
    compareSemantic('generation_plan.context', persistedPlan?.context, assessment.context, diagnostics);
    compareSemantic('generation_plan.required_checks', persistedPlan?.required_checks, assessment.generationPlan.required_checks, diagnostics);
    compareSemantic('generation_plan.publication', persistedPlan?.publication, assessment.generationPlan.publication, diagnostics);
    diagnostics.push(...exactCheckSetDiagnostics(persistedLedger, assessment.validationLedger));
    const expectedValidation = legacyValidationProjection(assessment.validationLedger, config, assessment.routing.domain);
    compareSemantic('legacy validation compatibility projection', artifact.validation, expectedValidation, diagnostics);
    compareSemantic('runtime checkout identity', {
      git_commit_sha: (artifact.runtime as Dict | undefined)?.git_commit_sha ?? null,
      expected_tested_sha: (artifact.runtime as Dict | undefined)?.expected_tested_sha ?? null,
      provenance_source: (artifact.runtime as Dict | undefined)?.provenance_source ?? null,
    }, { git_commit_sha: checkout.actual_sha, expected_tested_sha: checkout.expected_sha, provenance_source: checkout.source }, diagnostics);
    const expectedAuthorization = {
      authority_state: assessment.authorityDecision.authority_state,
      downstream_use_allowed: assessment.authorityDecision.downstream_use_allowed,
      review_required: assessment.authorityDecision.review_required,
      review_receipt: envelope.authorization.review_receipt,
      diagnostics: assessment.authorityDecision.diagnostics,
    };
    compareSemantic('authorization', envelope.authorization, expectedAuthorization, diagnostics);
  } catch (error) {
    diagnostics.push(`Canonical semantic recomputation failed: ${(error as Error).message}`);
  }

  const integrityDiagnostics = diagnostics.filter((item) => /schema|SHA-256|hash mismatch|digest mismatch|integrity|governing sources/i.test(item));
  const integrityValid = schemaErrors.length === 0 && artifactValid && envelopeValid && governingSourcesValid && integrityDiagnostics.length === 0;
  const semanticDiagnostics = diagnostics.filter((item) => /canonical|generation_plan|Check|compatibility projection|routing|risk|contract|policies|rules|runtime checkout/i.test(item));
  const semanticValid = Boolean(assessment && canonicalEnvelope) && semanticDiagnostics.length === 0;
  const authorityDiagnostics = diagnostics.filter((item) => item.startsWith('authorization'));
  const authorityConsistent = Boolean(assessment) && authorityDiagnostics.length === 0;
  const verificationStatus: VerificationStatus = diagnostics.length === 0
    ? 'verified'
    : unavailableSource || diagnostics.some((item) => item.includes('Governing source unavailable'))
      ? 'insufficient_evidence'
      : 'rejected';
  return {
    verification_status: verificationStatus,
    integrity_valid: integrityValid,
    semantic_derivation_valid: semanticValid,
    authority_consistent: authorityConsistent,
    artifact_sha256: envelope.artifact_sha256,
    authority_state: envelope.authorization.authority_state,
    downstream_use_allowed: verificationStatus === 'verified' && envelope.authorization.downstream_use_allowed,
    checks: assessment?.validationLedger ?? persistedLedger,
    diagnostics,
  };
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
