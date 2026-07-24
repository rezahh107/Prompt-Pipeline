import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { loadConfig, type Dict, type PEaCConfig } from './peac.js';
import {
  currentCheckoutIdentity,
  deriveAuthorityDecision,
  sha256Json,
  verifyArtifact,
  type ArtifactReviewReceipt,
  type GenerationPlan,
  type RuntimeArtifactEnvelope,
  type ValidationCheckRecord,
} from './runtime-authority.js';

export * from './runtime-authority.js';

function loadEnvelope(path: string): RuntimeArtifactEnvelope {
  const value = yaml.load(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Artifact envelope is not an object: ${path}`);
  return value as RuntimeArtifactEnvelope;
}

function authorityDirectory(config: PEaCConfig, state: 'authorized' | 'rejected'): string {
  return join(config.outputs_path, state);
}

function writeAtomic(path: string, value: RuntimeArtifactEnvelope): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing Artifact: ${path}`);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, yaml.dump(value, { lineWidth: 120, noRefs: true }));
  renameSync(temporary, path);
}

export function reviewArtifact(
  path: string,
  decision: 'approved' | 'rejected',
  limitations: string[] = [],
  configOverride?: PEaCConfig,
): { artifact: RuntimeArtifactEnvelope; outputPath: string } {
  const config = configOverride ?? loadConfig();
  const envelope = loadEnvelope(path);
  const verification = verifyArtifact(path, config);
  if (verification.verification_status !== 'verified') throw new Error(`Cannot review an unverified Artifact: ${verification.diagnostics.join('; ')}`);
  if (verification.authority_state !== 'review_pending' || envelope.authorization.authority_state !== 'review_pending') throw new Error(`Artifact is not canonically review_pending: ${String(verification.authority_state)}`);

  const artifact = envelope.artifact;
  const canonicalIntake = artifact.canonical_intake as Dict;
  const plan = artifact.generation_plan as GenerationPlan;
  const ledgerValue = artifact.validation_ledger as Dict;
  const ledger = Array.isArray(ledgerValue.checks) ? ledgerValue.checks as ValidationCheckRecord[] : [];
  const checkout = currentCheckoutIdentity();
  const preReview = deriveAuthorityDecision({
    sourceMode: canonicalIntake.source_mode as 'interactive_request' | 'api_request' | 'fixture_validation',
    riskAssessment: plan.risk,
    validationLedger: ledger,
    checkoutIdentity: checkout,
    reviewReceipt: null,
    artifactSha256: envelope.artifact_sha256,
  });
  if (preReview.authority_state !== 'review_pending') throw new Error(`Recomputed pre-review authority is ${preReview.authority_state}, not review_pending.`);

  const receipt: ArtifactReviewReceipt = {
    receipt_type: 'artifact_review',
    receipt_version: 'artifact-review.v1',
    artifact_sha256: envelope.artifact_sha256,
    reviewer: 'owner',
    decision,
    reviewed_at: new Date().toISOString(),
    limitations,
  };
  const reviewedDecision = deriveAuthorityDecision({
    sourceMode: canonicalIntake.source_mode as 'interactive_request' | 'api_request' | 'fixture_validation',
    riskAssessment: plan.risk,
    validationLedger: ledger,
    checkoutIdentity: checkout,
    reviewReceipt: receipt,
    artifactSha256: envelope.artifact_sha256,
  });
  const expectedState = decision === 'approved' ? 'authorized' : 'rejected';
  if (reviewedDecision.authority_state !== expectedState) throw new Error(`Review transition reducer returned ${reviewedDecision.authority_state}; expected ${expectedState}.`);

  const authorization = {
    authority_state: reviewedDecision.authority_state,
    downstream_use_allowed: reviewedDecision.downstream_use_allowed,
    review_required: reviewedDecision.review_required,
    review_receipt: receipt,
    diagnostics: reviewedDecision.diagnostics,
  };
  const { envelope_sha256: _previousEnvelopeSha256, ...baseEnvelope } = envelope;
  const withoutEnvelopeDigest = { ...baseEnvelope, authorization };
  const reviewed: RuntimeArtifactEnvelope = { ...withoutEnvelopeDigest, envelope_sha256: sha256Json(withoutEnvelopeDigest) };
  const outputPath = join(
    authorityDirectory(config, reviewedDecision.authority_state as 'authorized' | 'rejected'),
    `${String(envelope.artifact.prompt_id ?? 'artifact').replaceAll('.', '-')}-${envelope.artifact_sha256.slice(0, 16)}.yaml`,
  );
  writeAtomic(outputPath, reviewed);
  rmSync(path, { force: true });
  return { artifact: reviewed, outputPath };
}
