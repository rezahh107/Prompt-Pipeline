#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

type Dict = Record<string, unknown>;
type Rule = { rule_id?: string; title?: string; risk?: string; source_refs?: string[]; coverage_status?: string; next_hardening?: string[]; coverage?: Record<string, string[]> };
type FileShape = { version?: string; purpose?: string; rules?: Rule[] };
const MAIN = 'pipeline/behavioral-rule-coverage.yaml';
const BAD = 'tests/behavioral-coverage/invalid';
const RISKS = new Set(['low', 'medium', 'high', 'critical']);
const STATUSES = new Set(['validator_backed', 'fixture_tested', 'ci_enforced_lite', 'tracked_gap']);
const HIGH = new Set(['high', 'critical']);

function files(dir: string): string[] { const out: string[] = []; if (!existsSync(dir)) return out; for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...files(p)); else out.push(p); } return out; }
function load(p: string): unknown { const s = readFileSync(p, 'utf8'); return p.endsWith('.json') ? JSON.parse(s) as unknown : yaml.load(s) as unknown; }
function arr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []; }
function refPath(s: string): string { return s.split('#')[0] ?? s; }
function splitRef(s: string, sep: ':' | '#'): [string, string | null] { const i = sep === ':' ? s.lastIndexOf(':') : s.indexOf('#'); return i > 0 && i < s.length - 1 ? [s.slice(0, i), s.slice(i + 1)] : [s, null]; }
function hasId(x: unknown, id: string): boolean { if (Array.isArray(x)) return x.some((v) => hasId(v, id)); if (x && typeof x === 'object') { for (const [k, v] of Object.entries(x as Dict)) { if (k === id) return true; if (['id', 'name', 'policy_id', 'rule_id'].includes(k) && v === id) return true; if (hasId(v, id)) return true; } } return false; }
function schemaCarrier(s: string): boolean { const [p, id] = splitRef(s, ':'); if (!id || !existsSync(p)) return false; const x = load(p); const props = x && typeof x === 'object' ? (x as Dict).properties as Dict | undefined : undefined; return Boolean(props?.[id]) || hasId(x, id); }
function validatorFiles(r: Rule): string[] { const refs = arr(r.source_refs).map(refPath).filter((p) => /validators\.ya?ml$/.test(p)); return refs.length ? refs : files('domains').filter((p) => /validators\.ya?ml$/.test(p)); }
function validatorRule(r: Rule, id: string): boolean { return validatorFiles(r).some((p) => existsSync(p) && ((load(p) as { static_checks?: Array<{ id?: string }> })?.static_checks ?? []).some((c) => c.id === id)); }
function rubricCheck(s: string): boolean { const [rid, cid] = s.split('/'); if (!rid || !cid) return false; return files('evals').filter((p) => /\.ya?ml$/.test(p)).some((p) => { const x = load(p) as { rubric_id?: string; checks?: Array<{ id?: string }> }; return x.rubric_id === rid && (x.checks ?? []).some((c) => c.id === cid); }); }
function ciCommands(ciScript: string): string[] { return ciScript.split('&&').map((s) => s.trim()).filter(Boolean); }
function ciStep(step: string): boolean { const m = step.match(/^pnpm\s+([^\s]+)/); if (!m) return false; const script = m[1]; const pkg = load('package.json') as { scripts?: Record<string, string> }; const scripts = pkg.scripts ?? {}; if (!script || !scripts[script]) return false; if (script === 'ci') return true; return ciCommands(scripts.ci ?? '').some((cmd) => cmd === `pnpm ${script}` || cmd.startsWith(`pnpm ${script} `)); }
function downstream(s: string): boolean { const h = splitRef(s, '#'); const c = h[1] ? h : splitRef(s, ':'); const [p, id] = c; if (!existsSync(p)) return false; return !id || hasId(load(p), id); }
function anyCoverage(c: Record<string, string[]> | undefined): boolean { return Boolean(c && Object.values(c).some((v) => arr(v).length > 0)); }

function checkRule(r: Rule, i: number, fail: string[]): void {
  const label = r.rule_id ?? `rules[${i}]`;
  if (!r.rule_id) fail.push(`${label}: missing rule_id`);
  if (!r.title) fail.push(`${label}: missing title`);
  if (!r.risk || !RISKS.has(r.risk)) fail.push(`${label}: invalid or missing risk`);
  if (!r.coverage_status || !STATUSES.has(r.coverage_status)) fail.push(`${label}: invalid or missing coverage_status`);
  if (arr(r.source_refs).length === 0) fail.push(`${label}: missing source_refs`);
  for (const sr of arr(r.source_refs)) if (!existsSync(refPath(sr))) fail.push(`${label}: source_ref file does not exist: ${refPath(sr)}`);
  if (!r.coverage) fail.push(`${label}: missing coverage block`);
  for (const f of [...arr(r.coverage?.valid_fixtures), ...arr(r.coverage?.invalid_fixtures)]) if (!existsSync(f)) fail.push(`${label}: fixture file does not exist: ${f}`);
  for (const s of arr(r.coverage?.schema_carriers)) if (!schemaCarrier(s)) fail.push(`${label}: schema_carrier does not resolve: ${s}`);
  for (const s of arr(r.coverage?.validator_rules)) if (!validatorRule(r, s)) fail.push(`${label}: validator_rule does not resolve: ${s}`);
  for (const s of arr(r.coverage?.rubric_checks)) if (!rubricCheck(s)) fail.push(`${label}: rubric_check does not resolve: ${s}`);
  for (const s of arr(r.coverage?.ci_steps)) if (!ciStep(s)) fail.push(`${label}: ci_step does not resolve in package.json scripts.ci: ${s}`);
  for (const s of arr(r.coverage?.downstream_contracts)) if (!downstream(s)) fail.push(`${label}: downstream_contract does not resolve: ${s}`);
  if (r.risk && HIGH.has(r.risk)) {
    if (!anyCoverage(r.coverage)) fail.push(`${label}: high/critical rule has no coverage carrier`);
    if (r.coverage_status === 'tracked_gap' && arr(r.next_hardening).length === 0) fail.push(`${label}: tracked_gap requires next_hardening`);
    if (r.coverage_status === 'fixture_tested' && [...arr(r.coverage?.valid_fixtures), ...arr(r.coverage?.invalid_fixtures)].length === 0) fail.push(`${label}: fixture_tested requires at least one fixture`);
    if (r.coverage_status === 'validator_backed' && [...arr(r.coverage?.validator_rules), ...arr(r.coverage?.rubric_checks)].length === 0) fail.push(`${label}: validator_backed requires validator_rules or rubric_checks`);
  }
}
function checkFile(p: string): string[] { const fail: string[] = []; if (!existsSync(p)) return [`missing coverage file: ${p}`]; const x = load(p) as FileShape | null; if (!x?.version) fail.push(`${p}: missing version`); if (!x?.purpose) fail.push(`${p}: missing purpose`); if (!Array.isArray(x?.rules) || x.rules.length === 0) fail.push(`${p}: missing rules`); (x?.rules ?? []).forEach((r, i) => checkRule(r, i, fail)); return fail; }
const failures = checkFile(MAIN);
let invalidCount = 0;
for (const f of files(BAD).filter((p) => /\.ya?ml$/.test(p))) { invalidCount += 1; if (checkFile(f).length === 0) failures.push(`${f}: expected invalid coverage fixture to fail, but it passed`); }
if (failures.length) { console.error(`PEaC behavioral coverage check failed: ${failures.length}`); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
const main = load(MAIN) as FileShape;
console.log(`PEaC behavioral coverage check passed for ${main.rules?.length ?? 0} rule(s) and ${invalidCount} invalid fixture(s).`);
