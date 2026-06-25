#!/usr/bin/env tsx
import { parseArgs, syncRuleHashes } from '../src/peac.js';

const args = parseArgs(process.argv.slice(2));
const checkOnly = args.check === true;
const result = syncRuleHashes(checkOnly);

if (result.drifted.length > 0) {
  console.log(`Rule drift detected: ${result.drifted.length}`);
  for (const item of result.drifted) console.log(`- ${item}`);
  if (checkOnly) process.exit(1);
}

if (result.updated.length > 0) {
  console.log('Updated files:');
  for (const file of result.updated) console.log(`- ${file}`);
} else if (result.drifted.length === 0) {
  console.log('No rule drift detected.');
}
