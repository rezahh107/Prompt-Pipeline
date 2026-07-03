#!/usr/bin/env tsx
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { extractRuleBlocks, hashRuleBlock, syncRuleHashes, type PEaCConfig } from '../src/peac.js';

function assertTrue(name: string, condition: boolean): void {
  if (!condition) throw new Error(`${name}: expected true`);
}
function assertIncludes(name: string, haystack: string[], needle: string): void {
  if (!haystack.some((item) => item.includes(needle))) throw new Error(`${name}: expected ${needle} in ${haystack.join(' | ')}`);
}
function write(path: string, content: string): void {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(path, content);
}
function config(root: string): PEaCConfig {
  return {
    kb_path: join(root, 'kb'),
    policies_path: join(root, 'policies'),
    domains_path: join(root, 'domains'),
    pipeline_path: join(root, 'pipeline'),
    outputs_path: join(root, 'outputs'),
    default_execution_mode: 'ci',
    artifact: { schema: join(root, 'artifact.schema.json'), output_dir: join(root, 'outputs'), format: 'yaml' },
  };
}
function base(root: string): string {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  write(join(root, 'kb/canonical.md'), `# Canonical\n\n<!-- peac-rule-id: rule.valid -->\nValid rule body.\n<!-- /peac-rule-id -->\n`);
  return hashRuleBlock('Valid rule body.');
}

const root = join('outputs', 'sync-self-test');
const expectedHash = base(root);
write(join(root, 'policies/policy.yaml'), yaml.dump({
  policy_id: 'policy_valid',
  peac_rule_id: 'rule.valid',
  source_ref: 'outputs/sync-self-test/kb/canonical.md#rule.valid',
  source_hash: expectedHash,
  last_synced: '2026-07-03',
  rules: ['policy executable rule text'],
}));
write(join(root, 'domains/demo/rules.yaml'), yaml.dump({
  domain: 'demo',
  rules: [{ id: 'demo.valid', peac_rule_id: 'rule.valid', source_ref: 'outputs/sync-self-test/kb/canonical.md#rule.valid', source_hash: expectedHash, last_synced: '2026-07-03' }],
}));
let result = syncRuleHashes(true, config(root));
assertTrue('valid policy root and domain registry pass', result.missing.length === 0 && result.drifted.length === 0);

base(root);
write(join(root, 'domains/demo/rules.yaml'), yaml.dump({ domain: 'demo', rules: [{ id: 'missing.id', source_ref: 'outputs/sync-self-test/kb/canonical.md#rule.valid', source_hash: expectedHash, last_synced: '2026-07-03' }] }));
result = syncRuleHashes(true, config(root));
assertIncludes('missing metadata fails', result.missing, 'missing peac_rule_id');

base(root);
write(join(root, 'domains/demo/rules.yaml'), yaml.dump({ domain: 'demo', rules: [{ id: 'wrong.path', peac_rule_id: 'rule.valid', source_ref: 'kb/nonexistent.md#rule.valid', source_hash: expectedHash, last_synced: '2026-07-03' }] }));
result = syncRuleHashes(true, config(root));
assertIncludes('wrong source path fails', result.missing, 'does not match KB anchor file');

base(root);
write(join(root, 'domains/demo/rules.yaml'), yaml.dump({ domain: 'demo', rules: [{ id: 'drifted', peac_rule_id: 'rule.valid', source_ref: 'outputs/sync-self-test/kb/canonical.md#rule.valid', source_hash: 'badbadbadbadbadb', last_synced: '2026-07-03' }] }));
result = syncRuleHashes(true, config(root));
assertIncludes('drift fails', result.drifted, 'badbadbadbadbadb');

base(root);
write(join(root, 'kb/duplicate.md'), `# Duplicate\n\n<!-- peac-rule-id: rule.valid -->\nDuplicate rule body.\n<!-- /peac-rule-id -->\n`);
try {
  extractRuleBlocks(join(root, 'kb'));
  throw new Error('duplicate anchor accepted');
} catch (error) {
  assertTrue('duplicate anchor fails', (error as Error).message.includes('Duplicate KB rule anchors'));
}

const updateRoot = join(root, 'update-mode');
const updateHash = base(updateRoot);
write(join(updateRoot, 'domains/demo/rules.yaml'), yaml.dump({ domain: 'demo', rules: [{ id: 'update.me', peac_rule_id: 'rule.valid', source_ref: 'bad/path.md#rule.valid', source_hash: 'badbadbadbadbadb' }] }));
result = syncRuleHashes(false, config(updateRoot));
assertTrue('update mode updates file', result.updated.includes(join(updateRoot, 'domains/demo/rules.yaml')));
const updated = yaml.load(readFileSync(join(updateRoot, 'domains/demo/rules.yaml'), 'utf8')) as { rules: Array<{ source_ref: string; source_hash: string; last_synced: string }> };
assertTrue('update mode fixes source_ref', updated.rules[0].source_ref === 'outputs/sync-self-test/update-mode/kb/canonical.md#rule.valid');
assertTrue('update mode fixes hash', updated.rules[0].source_hash === updateHash);
assertTrue('update mode fills last_synced', typeof updated.rules[0].last_synced === 'string' && updated.rules[0].last_synced.length > 0);

console.log('PEaC sync hardening self tests passed.');
