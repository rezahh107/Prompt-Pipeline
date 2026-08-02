#!/usr/bin/env tsx
import { validateActiveDomainRoutes } from '../src/runtime-authority-route-schema.js';

const result = validateActiveDomainRoutes();
if (result.diagnostics.length > 0) {
  console.error(`PEaC route schema validation failed: ${result.diagnostics.length}`);
  for (const diagnostic of result.diagnostics) {
    console.error(`- [${diagnostic.code}] ${diagnostic.domain}: ${diagnostic.message}`);
  }
  process.exit(1);
}

console.log(`PEaC route schema validation passed for ${result.domains_checked} Domain(s) and ${result.subtypes_checked} Subtype(s).`);
