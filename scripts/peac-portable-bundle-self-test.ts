#!/usr/bin/env tsx
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { PR_INSPECTOR_MIGRATION_ERROR_CODE, PR_INSPECTOR_RETIRED_DOMAIN } from '../src/pr-inspector-boundary.js';

interface PEaCConfig { version?: string }
interface RouterConfig { domains?: Record<string, unknown> }

function assertTrue(name: string, condition: boolean): void {
  if (!condition) throw new Error(`${name}: expected true`);
}

function zipEntryNames(buffer: Buffer): string[] {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Actual portable ZIP has no end-of-central-directory record.');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const names: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Invalid central directory entry ${index}.`);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

const config = yaml.load(readFileSync('peac.config.yaml', 'utf8')) as PEaCConfig | null;
const bundlePath = join('dist', `Prompt-Pipeline-KB-Bundle-v${config?.version ?? 'dev'}.zip`);
const entries = zipEntryNames(readFileSync(bundlePath));
const inspectorEntries = entries.filter((entry) => entry.startsWith('domains/pr_inspector_action/'));
const reconstructiveNames = [
  'model_action.md',
  'human_handoff.md',
  'no_prompt.md',
  'route.json',
  'rules.yaml',
  'validators.yaml',
  'evals.yaml',
  'input.schema.json',
  'output.schema.json',
  'reason-compatibility.v1.11.0.json',
  'consumer-compatibility.v1.11.0.json',
];

assertTrue('actual portable bundle contains files', entries.length > 0);
assertTrue('complete PR-Inspector portable exclusion', inspectorEntries.length === 0);
for (const name of reconstructiveNames) {
  assertTrue(`portable bundle excludes ${name}`, !entries.some((entry) => entry === `domains/pr_inspector_action/${name}` || entry.endsWith(`/pr_inspector_action/${name}`)));
}
for (const entry of entries) {
  assertTrue('portable bundle excludes PR-Inspector fixtures', !entry.startsWith('domains/pr_inspector_action/fixtures/'));
  assertTrue('portable bundle excludes PR-Inspector templates', !entry.startsWith('domains/pr_inspector_action/templates/'));
}

const router = yaml.load(readFileSync('pipeline/router.yaml', 'utf8')) as RouterConfig | null;
assertTrue('active router excludes pr_inspector_action', !Object.prototype.hasOwnProperty.call(router?.domains ?? {}, PR_INSPECTOR_RETIRED_DOMAIN));

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'peac-pr-inspector-case-'));
try {
  const caseFile = join(temporaryDirectory, 'retired-domain.yaml');
  writeFileSync(caseFile, yaml.dump({ case_id: 'retired-domain-selection', domain: PR_INSPECTOR_RETIRED_DOMAIN, inputs: {} }), 'utf8');
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(command, ['exec', 'tsx', 'scripts/peac-generate.ts', '--case', caseFile, '--mode', 'ci'], {
    encoding: 'utf8',
    env: process.env,
  });
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  assertTrue('retired case-file generation exits non-zero', result.status !== 0);
  assertTrue('retired case-file generation returns deterministic migration error', combined.includes(PR_INSPECTOR_MIGRATION_ERROR_CODE));
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Portable bundle inspected: ${bundlePath}`);
console.log(`PR-Inspector bundle entries: ${JSON.stringify(inspectorEntries)}`);
console.log('PEaC portable bundle boundary tests passed.');
