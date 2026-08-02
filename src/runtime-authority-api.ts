import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { loadConfig, type PEaCConfig } from './peac.js';
import {
  type ArtifactReviewReceipt,
  type RuntimeArtifactEnvelope,
  sha256Json,
} from './runtime-authority-foundation.js';
import { completeRuntimeAssessmentInternal } from './runtime-authority-execution.js';
import { verifyArtifactForReviewInternal } from './runtime-authority-verification.js';

export * from './runtime-authority.js';

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
  const verified = verifyArtifactForReviewInternal(path, config);
  const envelope = verified.artifactEnvelope;
  const preReview = verified.completedAssessment;
  if (verified.verificationResult.verification_status !== 'verified') throw new Error('Artifact verification did not produce a verified canonical completion.');
  if (preReview.authorityDecision.authority_state !== 'review_pending' || envelope.authorization.authority_state !== 'review_pending') {
    throw new Error(`Artifact is not canonically review_pending: ${preReview.authorityDecision.authority_state}`);
  }

  const receipt: ArtifactReviewReceipt = {
    receipt_type: 'artifact_review',
    receipt_version: 'artifact-review.v1',
    artifact_sha256: envelope.artifact_sha256,
    reviewer: 'owner',
    decision,
    reviewed_at: new Date().toISOString(),
    limitations,
  };
  const reviewedCompletion = completeRuntimeAssessmentInternal({
    plan: preReview.plan,
    renderedPrompt: preReview.renderedPrompt,
    checkoutIdentity: preReview.checkoutIdentity,
    integrity: { artifact_valid: true, envelope_valid: true, governing_sources_valid: true },
    reviewReceipt: receipt,
    artifactSha256: envelope.artifact_sha256,
    config,
  });
  const expectedState = decision === 'approved' ? 'authorized' : 'rejected';
  if (reviewedCompletion.authorityDecision.authority_state !== expectedState) {
    throw new Error(`Canonical review transition returned ${reviewedCompletion.authorityDecision.authority_state}; expected ${expectedState}.`);
  }

  const authorization = {
    authority_state: reviewedCompletion.authorityDecision.authority_state,
    downstream_use_allowed: reviewedCompletion.authorityDecision.downstream_use_allowed,
    review_required: reviewedCompletion.authorityDecision.review_required,
    review_receipt: receipt,
    diagnostics: reviewedCompletion.authorityDecision.diagnostics,
  };
  const { envelope_sha256: _previousEnvelopeSha256, ...baseEnvelope } = envelope;
  const withoutEnvelopeDigest = { ...baseEnvelope, authorization };
  const reviewed = { ...withoutEnvelopeDigest, envelope_sha256: sha256Json(withoutEnvelopeDigest) } as RuntimeArtifactEnvelope;
  const outputPath = join(
    authorityDirectory(config, expectedState),
    `${verified.canonicalPromptIdentity.promptId.replaceAll('.', '-')}-${envelope.artifact_sha256.slice(0, 16)}.yaml`,
  );
  writeAtomic(outputPath, reviewed);
  rmSync(path, { force: true });
  return { artifact: reviewed, outputPath };
}
