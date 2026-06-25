#!/usr/bin/env tsx
import { generateArtifact, parseArgs } from '../src/peac.js';

const args = parseArgs(process.argv.slice(2));

try {
  const { artifact, outputPath } = generateArtifact(args);
  console.log(`PEaC artifact generated: ${outputPath}`);
  console.log('');
  console.log(artifact.rendered_prompt);
  if (!artifact.validation.passed) {
    console.error('Validation errors:');
    for (const error of artifact.validation.errors) console.error(`- ${error}`);
    process.exit(1);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
