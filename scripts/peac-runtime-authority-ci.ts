#!/usr/bin/env tsx

export {};

process.env.EXPECTED_TESTED_SHA ??= process.env.TESTED_SHA;
await import('./peac-runtime-review-debug.js');
await import('./peac-runtime-authority-self-test.js');
