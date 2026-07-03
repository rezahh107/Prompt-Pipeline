#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

interface Config { version?: string; pipeline_path: string; domains_path: string }
interface Intake {
  request: string;
  desired_output: string;
  target_environment: string;
  strictness: string;
  output_language?: string;
  domain_hint?: string | null;
  constraints?: string[];
  available_sources?: string[];
  requires_current_information?: boolean;
  uses_external_tools?: boolean;
  sensitive_or_high_risk?: boolean;
  requires_structured_output?: boolean;
}
interface RouterDomain { enabled?: boolean; keywords?: string[]; patterns?: string[]; confidence_threshold?: number }
interface Router { domains: Record<string, RouterDomain> }
interface Contract { fields?: { required?: Array<{ name: string }> } }
type Dict = Record<string, unknown>;

function args(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key?.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key.slice(2)] = true;
    else { out[key.slice(2)] = next; i += 1; }
  }
  return out;
}
function readYaml<T>(path: string): T { return yaml.load(readFileSync(path, 'utf8')) as T; }
function list(value: unknown): string[] | undefined { return typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : undefined; }
function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (['true', '1', 'yes'].includes(value.toLowerCase())) return true;
  if (['false', '0', 'no'].includes(value.toLowerCase())) return false;
  return undefined;
}
function clean<T extends Dict>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key as keyof T] = item as T[keyof T];
  return out;
}
function fromFlags(a: Record<string, string | boolean>): Partial<Intake> {
  return clean({
    request: typeof a.request === 'string' ? a.request : undefined,
    desired_output: typeof (a['desired-output'] ?? a.desired_output) === 'string' ? String(a['desired-output'] ?? a.desired_output) : undefined,
    target_environment: typeof (a['target-environment'] ?? a.target_environment) === 'string' ? String(a['target-environment'] ?? a.target_environment) : undefined,
    strictness: typeof a.strictness === 'string' ? a.strictness : undefined,
    output_language: typeof (a['output-language'] ?? a.output_language) === 'string' ? String(a['output-language'] ?? a.output_language) : undefined,
    domain_hint: typeof (a['domain-hint'] ?? a.domain_hint) === 'string' ? String(a['domain-hint'] ?? a.domain_hint) : undefined,
    constraints: list(a.constraints),
    available_sources: list(a['available-sources'] ?? a.available_sources),
    requires_current_information: bool(a['requires-current-information'] ?? a.requires_current_information),
    uses_external_tools: bool(a['uses-external-tools'] ?? a.uses_external_tools),
    sensitive_or_high_risk: bool(a['sensitive-or-high-risk'] ?? a.sensitive_or_high_risk),
    requires_structured_output: bool(a['requires-structured-output'] ?? a.requires_structured_output),
  });
}
function fmt(errors: ErrorObject[] | null | undefined): string { return (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`).join('; '); }
function validateIntake(value: unknown, config: Config): Intake {
  const schema = JSON.parse(readFileSync(join(config.pipeline_path, 'intake.schema.json'), 'utf8')) as object;
  const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(value)) throw new Error(`Intake validation failed: ${fmt(validate.errors)}`);
  return value as Intake;
}
function route(intake: Intake, config: Config): { domain: string; confidence: number; method: string } {
  if (intake.domain_hint) return { domain: intake.domain_hint, confidence: 1, method: 'domain_hint' };
  const router = readYaml<Router>(join(config.pipeline_path, 'router.yaml'));
  const text = intake.request.toLowerCase();
  for (const [domain, d] of Object.entries(router.domains)) {
    if (d.enabled === false || domain === 'general') continue;
    const kw = (d.keywords ?? []).some((k) => text.includes(k.toLowerCase()));
    const pat = (d.patterns ?? []).some((p) => new RegExp(p, 'i').test(intake.request));
    if (kw || pat) return { domain, confidence: d.confidence_threshold ?? 0.8, method: 'keyword_match' };
  }
  return { domain: 'general', confidence: 0.5, method: 'fallback_general_low_risk' };
}
function seedInputs(intake: Intake, domain: string): Dict {
  const common = clean({ output_language: intake.output_language, target_model: intake.target_environment });
  if (domain === 'prompt_generation') return clean({ ...common, task: intake.request, desired_output: intake.desired_output, target_environment: intake.target_environment, strictness: intake.strictness, user_constraints: (intake.constraints ?? []).join('\n') || 'No extra constraints provided.' });
  if (domain === 'document_review') return clean({ ...common, documents_description: intake.request, review_objective: intake.desired_output, desired_output: intake.desired_output, requires_current_research: intake.requires_current_information });
  if (domain === 'ai_workflow_design') return clean({ ...common, workflow_goal: intake.request, operating_context: intake.target_environment, target_environment: intake.target_environment, desired_artifacts: intake.desired_output });
  if (domain === 'multimodal') return clean({ ...common, multimodal_task: intake.request, asset_types: (intake.available_sources ?? []).join(', ') || 'unspecified', desired_output: intake.desired_output });
  return clean({ ...common, task: intake.request, output_format: intake.desired_output });
}
function missing(config: Config, domain: string, inputs: Dict): string[] {
  const path = join(config.domains_path, domain, 'input.contract.yaml');
  if (!existsSync(path)) return [`missing contract ${path}`];
  const contract = readYaml<Contract>(path);
  return (contract.fields?.required ?? []).map((f) => f.name).filter((name) => inputs[name] === undefined || inputs[name] === null || String(inputs[name]).trim() === '');
}
function write(path: string, content: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function checkFixtures(config: Config): void {
  const failures: string[] = [];
  let valid = 0, invalid = 0;
  for (const file of existsSync('intakes/valid') ? readdirSync('intakes/valid').filter((f) => f.endsWith('.yaml')) : []) {
    const path = join('intakes/valid', file);
    try { const intake = validateIntake(readYaml<unknown>(path), config); const r = route(intake, config); const miss = missing(config, r.domain, seedInputs(intake, r.domain)); if (miss.length) failures.push(`${path}: missing ${miss.join(', ')}`); valid += 1; } catch (e) { failures.push(`${path}: ${(e as Error).message}`); }
  }
  for (const file of existsSync('intakes/invalid') ? readdirSync('intakes/invalid').filter((f) => f.endsWith('.yaml')) : []) {
    try { validateIntake(readYaml<unknown>(join('intakes/invalid', file)), config); failures.push(`intakes/invalid/${file}: expected invalid`); } catch { invalid += 1; }
  }
  if (failures.length) { console.error(`PEaC intake check failed: ${failures.length}`); for (const failure of failures) console.error(`- ${failure}`); process.exit(1); }
  console.log(`PEaC intake check passed with ${valid} valid and ${invalid} invalid fixture(s).`);
}
const a = args(process.argv.slice(2));
const config = readYaml<Config>('peac.config.yaml');
if (a['check-fixtures'] === true) { checkFixtures(config); process.exit(0); }
const raw = typeof a.file === 'string' ? readYaml<unknown>(a.file) : fromFlags(a);
const intake = validateIntake(raw, config);
const routed = route(intake, config);
const domainInputs = seedInputs(intake, routed.domain);
const result = { intake_version: config.version ?? 'dev', intake, routing: routed, domain_inputs: domainInputs, missing_domain_inputs: missing(config, routed.domain, domainInputs) };
if (typeof a['out-intake'] === 'string') write(a['out-intake'], yaml.dump(result, { lineWidth: 120, noRefs: true }));
if (typeof a['out-case'] === 'string') {
  if (result.missing_domain_inputs.length) throw new Error(`Cannot emit case; missing ${result.missing_domain_inputs.join(', ')}`);
  write(a['out-case'], yaml.dump({ case_id: `intake.${routed.domain}.v1`, domain: routed.domain, version: config.version ?? 'dev', inputs: domainInputs, expected: { validation: { should_pass: true } } }, { lineWidth: 120, noRefs: true }));
}
console.log(yaml.dump(result, { lineWidth: 120, noRefs: true }));
