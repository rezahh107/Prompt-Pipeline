#!/usr/bin/env tsx
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

process.env.EXPECTED_TESTED_SHA ??= process.env.TESTED_SHA;

const sourceUrl = new URL('./peac-runtime-authority-self-test.ts', import.meta.url);
const generatedUrl = new URL('./.peac-runtime-authority-self-test.generated.ts', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8').replace(
  "../src/runtime-authority.js",
  "../src/runtime-authority-api.js",
);
writeFileSync(generatedUrl, source);
try {
  await import(`${generatedUrl.href}?run=${Date.now()}`);
} finally {
  rmSync(generatedUrl, { force: true });
}
