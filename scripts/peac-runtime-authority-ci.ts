#!/usr/bin/env tsx
process.env.EXPECTED_TESTED_SHA ??= process.env.TESTED_SHA;

for (const source of [
  './peac-canonical-planning-closure-test.ts',
  './peac-route-schema-test.ts',
  './peac-canonical-test-eval-parity-test.ts',
  './peac-delegated-domain-prompt-test.ts',
  './peac-runtime-authority-self-test.ts',
  './peac-runtime-authority-evidence-lock-test.ts',
  './peac-runtime-authority-v25-test.ts',
]) {
  const sourceUrl = new URL(source, import.meta.url);
  await import(`${sourceUrl.href}?run=${Date.now()}-${encodeURIComponent(source)}`);
}
