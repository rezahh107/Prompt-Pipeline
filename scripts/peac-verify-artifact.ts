#!/usr/bin/env tsx
import yaml from 'js-yaml';
import { parseArgs } from '../src/peac.js';
import { verifyArtifact } from '../src/runtime-authority-api.js';

const args = parseArgs(process.argv.slice(2));
if (args.help === true) {
  console.log('Usage: pnpm peac:verify-artifact -- <artifact-path>\n   or: pnpm peac:verify-artifact -- --artifact <artifact-path>');
  process.exit(0);
}
const positional = process.argv.slice(2).find((value) => !value.startsWith('--'));
const artifactPath = typeof args.artifact === 'string' ? args.artifact : positional;
if (!artifactPath) {
  console.error('Artifact path is required.');
  process.exit(1);
}
const result = verifyArtifact(artifactPath);
console.log(yaml.dump(result, { lineWidth: 120, noRefs: true }));
if (result.verification_status !== 'verified') process.exit(1);
