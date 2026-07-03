#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { parseArgs } from '../src/peac.js';

type Dict = Record<string, unknown>;
interface Config { kb_path: string; policies_path: string; domains_path: string }
interface SyncResult { missing: string[]; drifted: string[]; updated: string[]; orphaned: string[] }

function readYaml<T>(path: string): T | null { return (yaml.load(readFileSync(path, 'utf8')) as T | null | undefined) ?? null }
function writeYaml(path: string, value: unknown): void { writeFileSync(path, yaml.dump(value, { lineWidth: 100, noRefs: true })) }
function walkFiles(dir: string): string[] { const result: string[] = []; if (!existsSync(dir)) return result; for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) result.push(...walkFiles(path)); if (entry.isFile()) result.push(path) } return result }
function hashRuleBlock(content: string): string { return createHash('sha256').update(content.trim()).digest('hex').slice(0, 16) }
function extractRuleBlocks(kbRoot: string): Map<string, { body: string; file: string }> { const blocks = new Map<string, { body: string; file: string }>(); const pattern = /<!--\s*peac-rule-id:\s*([^\s]+)\s*-->([\s\S]*?)<!--\s*\/peac-rule-id\s*-->/g; for (const file of walkFiles(kbRoot).filter((path) => path.endsWith('.md'))) { const content = readFileSync(file, 'utf8'); for (const match of content.matchAll(pattern)) { const id = match[1]; const body = match[2]; if (id && body) blocks.set(id, { body: body.trim(), file }) } } return blocks }
function trackedFiles(config: Config): string[] { return [...walkFiles(config.policies_path).filter((file) => file.endsWith('.yaml')), ...walkFiles(config.domains_path).filter((file) => file.endsWith('rules.yaml'))].sort() }
function entriesFor(data: Dict): Dict[] { return Array.isArray(data.rules) ? data.rules as Dict[] : [data] }
function sourceRefId(sourceRef: unknown): string | null { if (typeof sourceRef !== 'string') return null; const index = sourceRef.indexOf('#'); return index >= 0 ? sourceRef.slice(index + 1) : null }
function validateAndSyncEntry(file: string, entry: Dict, blocks: Map<string, { body: string; file: string }>, checkOnly: boolean, referenced: Set<string>, result: SyncResult): boolean {
  const localId = String(entry.id ?? entry.policy_id ?? 'unnamed');
  const ruleId = typeof entry.peac_rule_id === 'string' ? entry.peac_rule_id : null;
  if (!ruleId) { result.missing.push(`${file}#${localId}: missing peac_rule_id`); return false }
  referenced.add(ruleId);
  const refId = sourceRefId(entry.source_ref);
  if (refId !== ruleId) result.missing.push(`${file}#${localId}: source_ref must end with #${ruleId}`);
  const block = blocks.get(ruleId);
  if (!block) { result.missing.push(`${file}#${localId}: missing KB rule anchor ${ruleId}`); return false }
  const expectedHash = hashRuleBlock(block.body);
  let changed = false;
  if (entry.source_hash !== expectedHash) {
    result.drifted.push(`${file}#${localId}: source_hash ${String(entry.source_hash ?? '<missing>')} != ${expectedHash}`);
    if (!checkOnly) { entry.source_hash = expectedHash; changed = true }
  }
  if (typeof entry.last_synced !== 'string' || entry.last_synced.trim() === '') {
    result.missing.push(`${file}#${localId}: missing last_synced`);
    if (!checkOnly) { entry.last_synced = new Date().toISOString().slice(0, 10); changed = true }
  }
  if (typeof entry.source_ref !== 'string') result.missing.push(`${file}#${localId}: missing source_ref`);
  return changed;
}
function syncRuleHashes(checkOnly: boolean): SyncResult {
  const config = readYaml<Config>('peac.config.yaml');
  if (!config) throw new Error('peac.config.yaml is empty or invalid');
  const blocks = extractRuleBlocks(config.kb_path);
  const referenced = new Set<string>();
  const result: SyncResult = { missing: [], drifted: [], updated: [], orphaned: [] };
  for (const file of trackedFiles(config)) {
    const data = readYaml<Dict>(file);
    if (!data || typeof data !== 'object') continue;
    let changed = false;
    for (const entry of entriesFor(data)) changed = validateAndSyncEntry(file, entry, blocks, checkOnly, referenced, result) || changed;
    if (changed) { writeYaml(file, data); result.updated.push(file) }
  }
  result.orphaned = [...blocks.keys()].filter((id) => !referenced.has(id)).sort();
  return result;
}

const args = parseArgs(process.argv.slice(2));
const checkOnly = args.check === true;
const result = syncRuleHashes(checkOnly);

if (result.missing.length > 0) { console.error(`Rule coverage metadata missing: ${result.missing.length}`); for (const item of result.missing) console.error(`- ${item}`) }
if (result.drifted.length > 0) { console.error(`Rule drift detected: ${result.drifted.length}`); for (const item of result.drifted) console.error(`- ${item}`) }
if (result.orphaned.length > 0) { console.warn(`Orphaned KB rule anchors: ${result.orphaned.length}`); for (const item of result.orphaned) console.warn(`- ${item}`) }
if (checkOnly && (result.missing.length > 0 || result.drifted.length > 0)) process.exit(1);
if (result.updated.length > 0) { console.log('Updated files:'); for (const file of result.updated) console.log(`- ${file}`) }
else if (result.drifted.length === 0 && result.missing.length === 0) console.log('No blocking rule drift detected.');
