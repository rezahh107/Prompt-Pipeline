#!/usr/bin/env tsx
import { parseArgs } from '../src/peac.js';
import { reviewArtifact } from '../src/runtime-authority.js';

const args = parseArgs(process.argv.slice(2));
if (args.help === true) {
  console.log('Usage: pnpm peac:review-artifact -- --artifact <path> --decision approved|rejected [--limitations text]');
  process.exit(0);
}
const artifactPath = typeof args.artifact === 'string' ? args.artifact : null;
const decision = args.decision;
if (!artifactPath) throw new Error('--artifact is required.');
if (decision !== 'approved' && decision !== 'rejected') throw new Error('--decision must be approved or rejected.');
const limitations = typeof args.limitations === 'string' ? args.limitations.split('|').map((item) => item.trim()).filter(Boolean) : [];
const result = reviewArtifact(artifactPath, decision, limitations);
console.log(`Reviewed Artifact published: ${result.outputPath}`);
console.log(`authority_state: ${result.artifact.authorization.authority_state}`);
console.log(`downstream_use_allowed: ${String(result.artifact.authorization.downstream_use_allowed)}`);
