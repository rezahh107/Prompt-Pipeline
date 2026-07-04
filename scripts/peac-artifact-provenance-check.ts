#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import yaml from 'js-yaml';
import { generateArtifact, loadConfig, routeRequestForTest } from '../src/peac.js';

type Dict = Record<string, unknown>;

interface Artifact {
  prompt_id: string;
  domain: string;
  rendered_prompt: string;
  policies_applied: Array<{ id: string; source_ref: string; source_hash: string | null; triggered_by: string }>;
  validation: { passed: boolean; checks_run: string[]; errors: string[]; warnings: string[] };
  runtime: { node_version: string; package_manager: string | null; pipeline_version: string | null; git_commit_sha: string | null };
  provenance: { user_request: string; case_file: string | null; routing_method: string; routing_confidence: number; routing_evidence: null | { score: number; priority: number; matched_terms: string[]; negative_terms: string[]; competing_candidates: Array<{ domain: string; score: number; confidence: number; priority: number; matched_terms: string[]; negative_terms: string[] }> }; template_used: string; template_version: string; inputs_provided: string[]; inputs_inferred: string[]; inputs_defaulted: string[] };
  hashes: { config_hash: string; contract_hash: string; route_hash: string; template_hash: string; validators_hash: string; policies_hash: string; rendered_prompt_hash: string };
}

function sha256(content: string): string { return createHash('sha256').update(content).digest('hex'); }
function sortedJson(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortedJson); if (value !== null && typeof value === 'object') { const out: Dict = {}; for (const key of Object.keys(value).sort()) out[key] = sortedJson((value as Dict)[key]); return out; } return value; }
function hashJson(value: unknown): string { return sha256(JSON.stringify(sortedJson(value)) ?? 'undefined'); }
function walkCases(dir: string): string[] { const result: string[] = []; for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const path = join(dir, entry.name); if (entry.isDirectory()) result.push(...walkCases(path)); if (entry.isFile() && path.replaceAll('\\', '/').includes('/cases/') && path.endsWith('.yaml')) result.push(path); } return result; }
function caseShouldPass(caseFile: string): boolean { const data = yaml.load(readFileSync(caseFile, 'utf8')) as { expected?: { validation?: { should_pass?: boolean } } } | null; return data?.expected?.validation?.should_pass !== false; }
function packageManager(): string | null { try { return (JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager?: string }).packageManager ?? null; } catch { return null; } }
function requireFileHash(failures: string[], label: string, path: string, expected: string): void { if (!existsSync(path)) { failures.push(`${label}: missing file ${path}`); return; } const actual = sha256(readFileSync(path, 'utf8')); if (actual !== expected) failures.push(`${label}: hash mismatch for ${path}`); }
function assertArray(name: string, value: string[], failures: string[], label: string, allowEmpty = false): void { if (!Array.isArray(value)) failures.push(`${label}: ${name} is not an array`); else if (!allowEmpty && value.length === 0) failures.push(`${label}: ${name} is empty`); }

function isInsideDirectory(child: string, parent: string): boolean {
  const childPath = resolve(child);
  const parentPath = resolve(parent);
  const rel = relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function checkPathContainmentRegression(failures: string[]): void {
  const templateRoot = join('domains', 'image', 'templates');
  const valid = join(templateRoot, 'academic-portrait.j2');
  const siblingPrefix = join('domains', 'image', 'templates_evil', 'academic-portrait.j2');
  const traversal = join(templateRoot, '..', 'templates_evil', 'academic-portrait.j2');
  if (!isInsideDirectory(valid, templateRoot)) failures.push('path containment regression: valid template path rejected');
  if (isInsideDirectory(siblingPrefix, templateRoot)) failures.push('path containment regression: sibling-prefix template path accepted');
  if (isInsideDirectory(traversal, templateRoot)) failures.push('path containment regression: traversal template path accepted');
}

function checkArtifact(label: string, artifact: Artifact, failures: string[]): void {
  const config = loadConfig();
  const contractPath = join(config.domains_path, artifact.domain, 'input.contract.yaml');
  const routePath = join(config.domains_path, artifact.domain, 'route.yaml');
  const validatorsPath = join(config.domains_path, artifact.domain, 'validators.yaml');
  const templateRoot = join(config.domains_path, artifact.domain, 'templates');
  if (!artifact.validation.passed) failures.push(`${label}: artifact validation failed: ${artifact.validation.errors.join('; ')}`);
  assertArray('validation.checks_run', artifact.validation.checks_run, failures, label);
  assertArray('provenance.inputs_provided', artifact.provenance.inputs_provided, failures, label);
  assertArray('provenance.inputs_inferred', artifact.provenance.inputs_inferred, failures, label);
  assertArray('provenance.inputs_defaulted', artifact.provenance.inputs_defaulted, failures, label, true);
  if (!existsSync(artifact.provenance.template_used)) failures.push(`${label}: template_used does not exist: ${artifact.provenance.template_used}`);
  if (!isInsideDirectory(artifact.provenance.template_used, templateRoot)) failures.push(`${label}: template_used is outside expected domain template directory`);
  if (artifact.provenance.template_version.trim() === '') failures.push(`${label}: template_version is empty`);
  requireFileHash(failures, label, 'peac.config.yaml', artifact.hashes.config_hash);
  requireFileHash(failures, label, contractPath, artifact.hashes.contract_hash);
  requireFileHash(failures, label, routePath, artifact.hashes.route_hash);
  requireFileHash(failures, label, artifact.provenance.template_used, artifact.hashes.template_hash);
  requireFileHash(failures, label, validatorsPath, artifact.hashes.validators_hash);
  if (sha256(artifact.rendered_prompt) !== artifact.hashes.rendered_prompt_hash) failures.push(`${label}: rendered_prompt_hash mismatch`);
  if (hashJson(artifact.policies_applied) !== artifact.hashes.policies_hash) failures.push(`${label}: policies_hash mismatch`);
  for (const policy of artifact.policies_applied) {
    if (!policy.id || !policy.source_ref || !policy.triggered_by) { failures.push(`${label}: policy provenance is incomplete`); continue; }
    if (!policy.source_hash) failures.push(`${label}: policy ${policy.id} is missing source_hash`);
    if (!policy.source_ref.includes('#')) failures.push(`${label}: policy ${policy.id} source_ref lacks rule anchor fragment`);
  }
  if (artifact.runtime.node_version.trim() === '') failures.push(`${label}: node_version is empty`);
  if (artifact.runtime.package_manager !== packageManager()) failures.push(`${label}: package_manager mismatch`);
  if (artifact.runtime.pipeline_version !== config.version) failures.push(`${label}: pipeline_version mismatch`);
}

const config = loadConfig();
const failures: string[] = [];
let checked = 0;
let skipped = 0;

checkPathContainmentRegression(failures);

for (const caseFile of walkCases(config.domains_path)) {
  if (!caseShouldPass(caseFile)) { skipped += 1; continue; }
  try {
    const artifact = generateArtifact({ case: caseFile, mode: 'ci' }).artifact as Artifact;
    if (artifact.provenance.case_file !== caseFile) failures.push(`${caseFile}: case_file provenance mismatch`);
    if (artifact.provenance.routing_method !== 'case_file') failures.push(`${caseFile}: case artifact routing_method mismatch`);
    if (artifact.provenance.routing_evidence !== null) failures.push(`${caseFile}: case artifact should not have routing_evidence`);
    checkArtifact(caseFile, artifact, failures);
    checked += 1;
  } catch (error) { failures.push(`${caseFile}: generation failed: ${(error as Error).message}`); }
}

try {
  const routedArtifact = generateArtifact({ request: 'give me a practical decision framework', mode: 'ci' }).artifact as Artifact;
  if (routedArtifact.provenance.case_file !== null) failures.push('request artifact: case_file must be null');
  if (routedArtifact.provenance.routing_method === 'case_file') failures.push('request artifact: routing_method must not be case_file');
  if (routedArtifact.provenance.routing_evidence !== null) failures.push('request artifact: general fallback should not carry routing_evidence');
  checkArtifact('request artifact', routedArtifact, failures);
  checked += 1;
} catch (error) { failures.push(`request artifact: generation failed: ${(error as Error).message}`); }

const routed = routeRequestForTest('review code for correctness and tests');
if (routed.method !== 'evidence_concept_score') failures.push('router evidence sample: expected evidence_concept_score');
if (!routed.evidence) failures.push('router evidence sample: missing evidence');
else {
  if (routed.evidence.score <= 0) failures.push('router evidence sample: non-positive score');
  if (routed.evidence.matched_terms.length === 0) failures.push('router evidence sample: missing matched_terms');
  if (!Array.isArray(routed.evidence.competing_candidates)) failures.push('router evidence sample: competing_candidates is not an array');
}

if (failures.length > 0) {
  console.error(`PEaC artifact provenance check failed: ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PEaC artifact provenance check passed for ${checked} artifact(s), skipped ${skipped} expected failing fixture(s).`);
