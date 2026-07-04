#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { generateArtifact } from '../src/peac.js';

type Dict = Record<string, unknown>;
interface ReviewSubject { risk_level?: string; requires_human_review?: boolean; review_reason?: unknown }
interface CaseFile { expected?: { validation?: { should_pass?: boolean } } }
const INVALID_ROOT = 'tests/human-review-gate/invalid';

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (path.endsWith('.yaml') || path.endsWith('.yml')) out.push(path);
  }
  return out;
}
function loadYaml<T>(path: string): T { return yaml.load(readFileSync(path, 'utf8')) as T }
function shouldPassCase(path: string): boolean { const data = loadYaml<CaseFile>(path); return data.expected?.validation?.should_pass !== false }
function reviewFailures(label: string, subject: ReviewSubject): string[] {
  const failures: string[] = [];
  const reason = typeof subject.review_reason === 'string' ? subject.review_reason.trim() : '';
  if (subject.risk_level === 'high' && subject.requires_human_review !== true) failures.push(`${label}: high risk must require human review`);
  if (subject.requires_human_review === true) {
    if (!reason) failures.push(`${label}: requires_human_review=true requires non-empty review_reason`);
    else if (!reason.startsWith('Human review required:')) failures.push(`${label}: review_reason must start with "Human review required:"`);
  }
  if (subject.requires_human_review === false && subject.review_reason !== null) failures.push(`${label}: requires_human_review=false requires review_reason to be null`);
  return failures;
}
function caseFiles(): string[] { return walk('domains').filter((path) => path.replaceAll('\\', '/').includes('/cases/') && !path.replaceAll('\\', '/').includes('/cases/invalid/') && path.endsWith('.yaml')) }
const failures: string[] = [];
let skippedCases = 0;
for (const file of caseFiles()) {
  if (!shouldPassCase(file)) { skippedCases += 1; continue; }
  try {
    const { artifact } = generateArtifact({ case: file, mode: 'ci' });
    failures.push(...reviewFailures(file, artifact));
  } catch (error) {
    failures.push(`${file}: expected pass, got error: ${(error as Error).message}`);
  }
}
let invalidCount = 0;
for (const file of walk(INVALID_ROOT)) {
  invalidCount += 1;
  const fixture = loadYaml<Dict>(file);
  const result = reviewFailures(file, fixture as ReviewSubject);
  if (result.length === 0) failures.push(`${file}: expected invalid human-review fixture to fail, but it passed`);
}
if (failures.length > 0) {
  console.error(`PEaC human review gate failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PEaC human review gate passed for ${caseFiles().length - skippedCases} case(s), skipped ${skippedCases} expected failing case(s), and checked ${invalidCount} invalid fixture(s).`);
