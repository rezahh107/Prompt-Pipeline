#!/usr/bin/env tsx

process.env.EXPECTED_TESTED_SHA ??= process.env.TESTED_SHA;
await import('./peac-runtime-authority-self-test.js');
