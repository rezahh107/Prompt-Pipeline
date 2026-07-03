#!/usr/bin/env tsx
import { parseArgs, syncRuleHashes } from '../src/peac.js';

const args = parseArgs(process.argv.slice(2));
const checkOnly = args.check === true;
const result = syncRuleHashes(checkOnly);

if (result.missing.length > 0) {
  console.error(`Rule coverage metadata missing: ${result.missing.length}`);
  for (const item of result.missing) console.error(`- ${item}`);
}

if (result.drifted.length > 0) {
  console.error(`Rule drift detected: ${result.drifted.length}`);
  for (const item of result.drifted) console.error(`- ${item}`);
}

if (result.orphaned.length > 0) {
  console.warn(`Orphaned KB rule anchors: ${result.orphaned.length}`);
  for (const item of result.orphaned) console.warn(`- ${item}`);
}

if (checkOnly && (result.missing.length > 0 || result.drifted.length > 0)) {
  process.exit(1);
}

if (result.updated.length > 0) {
  console.log('Updated files:');
  for (const file of result.updated) console.log(`- ${file}`);
} else if (result.drifted.length === 0 && result.missing.length === 0) {
  console.log('No blocking rule drift detected.');
}
