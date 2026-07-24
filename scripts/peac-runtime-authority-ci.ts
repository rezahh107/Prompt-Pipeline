#!/usr/bin/env tsx
process.env.EXPECTED_TESTED_SHA ??= process.env.TESTED_SHA;
const sourceUrl = new URL('./peac-runtime-authority-self-test.ts', import.meta.url);
await import(`${sourceUrl.href}?run=${Date.now()}`);
