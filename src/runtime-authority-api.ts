import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { loadConfig, type PEaCConfig } from './peac.js';
import {
  sha256Json,
  verifyArtifact,
  type ArtifactReviewReceipt,
  type RuntimeArtifactEnvelope,
} from './runtime-authority.js';

export * from './runtime-authority.js';

function loadEnvelope(path: string): RuntimeArtifactEnvelope {
  const value = yaml.load(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Artifact envelope is not an object: ${path}`);
  }
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
  if (verification.verification_status !== 'verified') {
    throw new Error(`Cannot review an unverified Artifact: ${verification.diagnostics.join('; ')}`);
  }
  if (envelope.authorization.authority_state !== 'review_pending') {
    throw new Error(`Artifact is not review_pending: ${envelope.authorization.authority_state}`);
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
  const authorization = {
    authority_state: decision === 'approved' ? 'authorized' as const : 'rejected' as const,
    downstream_use_allowed: decision === 'approved',
    review_required: true,
    review_receipt: receipt,
    diagnostics: decision === 'approved' ? [] : ['Owner review rejected the Artifact.'],
  };
  const { envelope_sha256: _previousEnvelopeSha256, ...baseEnvelope } = envelope;
  const withoutEnvelopeDigest = { ...baseEnvelope, authorization };
  const reviewed: RuntimeArtifactEnvelope = {
    ...withoutEnvelopeDigest,
    envelope_sha256: sha256Json(withoutEnvelopeDigest),
  };
  const outputPath = join(
    authorityDirectory(config, authorization.authority_state),
    `${String(envelope.artifact.prompt_id ?? 'artifact').replaceAll('.', '-')}-${envelope.artifact_sha256.slice(0, 16)}.yaml`,
  );
  writeAtomic(outputPath, reviewed);
  rmSync(path, { force: true });
  return { artifact: reviewed, outputPath };
}
