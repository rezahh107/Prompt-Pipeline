#!/usr/bin/env tsx
import { assertCaseFileDomainAllowed } from '../src/pr-inspector-boundary.js';
import { parseArgs } from '../src/peac.js';
import { generateFromCliArgs } from '../src/runtime-authority-api.js';

process.env.EXPECTED_TESTED_SHA ??= process.env.TESTED_SHA;

const args = parseArgs(process.argv.slice(2));

if (args.help === true) {
  console.log(`Usage:
  pnpm peac:generate -- --request <intake-file-or-request-text> [--mode batch|interactive|ci|agent]
  pnpm peac:generate -- --case <case-file> [--mode ci]

--request always passes through canonical intake.
--case always runs as non-authoritative fixture validation.`);
  process.exit(0);
}

try {
  assertCaseFileDomainAllowed(args.case);
  const { artifact, outputPath } = generateFromCliArgs(args);
  console.log(`PEaC Runtime Artifact: ${outputPath}`);
  console.log(`authority_state: ${artifact.authorization.authority_state}`);
  console.log(`downstream_use_allowed: ${String(artifact.authorization.downstream_use_allowed)}`);
  console.log('');
  console.log(String(artifact.artifact.rendered_prompt ?? ''));
  if (artifact.authorization.authority_state === 'rejected') {
    for (const diagnostic of artifact.authorization.diagnostics) console.error(`- ${diagnostic}`);
    process.exit(1);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
