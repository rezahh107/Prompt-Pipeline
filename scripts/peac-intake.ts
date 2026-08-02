#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import type { Dict } from '../src/peac.js';
import {
  compileRuntimePlan,
  createValidatedIntakeEnvelope,
  type RuntimePlanAssessment,
  type SourceMode,
} from '../src/runtime-authority-api.js';

class IntakeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeValidationError';
  }
}

const KNOWN_FLAGS = new Set([
  'request', 'desired-output', 'desired_output', 'target-environment', 'target_environment', 'strictness',
  'output-language', 'output_language', 'model-profile', 'model_profile', 'context-policy', 'context_policy',
  'context-budget-tokens', 'context_budget_tokens', 'prompt-language', 'prompt_language',
  'explanation-language', 'explanation_language', 'target-output-language', 'target_output_language',
  'domain-hint', 'domain_hint', 'domain-inputs', 'domain_inputs', 'constraints',
  'available-sources', 'available_sources', 'success-criteria', 'success_criteria',
  'failure-modes', 'failure_modes', 'eval-suite', 'eval_suite',
  'requires-current-information', 'requires_current_information', 'uses-external-tools', 'uses_external_tools',
  'sensitive-or-high-risk', 'sensitive_or_high_risk', 'requires-structured-output', 'requires_structured_output',
  'human-review-required', 'human_review_required', 'file', 'out-intake', 'out-case', 'check-fixtures',
]);

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) continue;
    const key = argument.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function value(args: Record<string, string | boolean>, ...names: string[]): string | undefined {
  for (const name of names) if (typeof args[name] === 'string') return String(args[name]);
  return undefined;
}

function list(input: string | undefined): string[] | undefined {
  return input?.split(',').map((item) => item.trim()).filter(Boolean);
}

function integer(name: string, input: string | undefined): number | undefined {
  if (input === undefined) return undefined;
  const result = Number(input);
  if (!Number.isInteger(result)) throw new IntakeValidationError(`Invalid integer flag ${name}: ${input}`);
  return result;
}

function boolean(name: string, input: string | undefined): boolean | undefined {
  if (input === undefined) return undefined;
  if (['true', '1', 'yes'].includes(input.toLowerCase())) return true;
  if (['false', '0', 'no'].includes(input.toLowerCase())) return false;
  throw new IntakeValidationError(`Invalid boolean flag ${name}: ${input}`);
}

function jsonObject(name: string, input: string | undefined): Dict | undefined {
  if (input === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new IntakeValidationError(`Invalid JSON for ${name}: ${(error as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new IntakeValidationError(`${name} must be a JSON object.`);
  return parsed as Dict;
}

function clean(value: Dict): Dict {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function fromFlags(args: Record<string, string | boolean>): Dict {
  for (const key of Object.keys(args)) if (!KNOWN_FLAGS.has(key)) throw new IntakeValidationError(`Unknown intake flag: --${key}`);
  return clean({
    request: value(args, 'request'),
    desired_output: value(args, 'desired-output', 'desired_output'),
    target_environment: value(args, 'target-environment', 'target_environment'),
    strictness: value(args, 'strictness'),
    output_language: value(args, 'output-language', 'output_language'),
    model_profile: value(args, 'model-profile', 'model_profile'),
    context_policy: value(args, 'context-policy', 'context_policy'),
    context_budget_tokens: integer('context-budget-tokens', value(args, 'context-budget-tokens', 'context_budget_tokens')),
    prompt_language: value(args, 'prompt-language', 'prompt_language'),
    explanation_language: value(args, 'explanation-language', 'explanation_language'),
    target_output_language: value(args, 'target-output-language', 'target_output_language'),
    domain_hint: value(args, 'domain-hint', 'domain_hint'),
    domain_inputs: jsonObject('domain-inputs', value(args, 'domain-inputs', 'domain_inputs')),
    constraints: list(value(args, 'constraints')),
    available_sources: list(value(args, 'available-sources', 'available_sources')),
    success_criteria: list(value(args, 'success-criteria', 'success_criteria')),
    failure_modes: list(value(args, 'failure-modes', 'failure_modes')),
    eval_suite: list(value(args, 'eval-suite', 'eval_suite')),
    requires_current_information: boolean('requires-current-information', value(args, 'requires-current-information', 'requires_current_information')),
    uses_external_tools: boolean('uses-external-tools', value(args, 'uses-external-tools', 'uses_external_tools')),
    sensitive_or_high_risk: boolean('sensitive-or-high-risk', value(args, 'sensitive-or-high-risk', 'sensitive_or_high_risk')),
    requires_structured_output: boolean('requires-structured-output', value(args, 'requires-structured-output', 'requires_structured_output')),
    human_review_required: boolean('human-review-required', value(args, 'human-review-required', 'human_review_required')),
  });
}

function readYaml(path: string): unknown {
  return yaml.load(readFileSync(path, 'utf8'));
}

function writeYaml(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, yaml.dump(data, { lineWidth: 120, noRefs: true }));
}

export function planCanonicalIntake(raw: unknown, sourceMode: SourceMode = 'api_request'): RuntimePlanAssessment {
  return compileRuntimePlan(createValidatedIntakeEnvelope(raw, sourceMode));
}

function checkFixtures(): void {
  const failures: string[] = [];
  let validCount = 0;
  let invalidCount = 0;
  try {
    fromFlags({ request: 'x', 'uses-external-tool': 'true' });
    failures.push('unknown flag typo was accepted');
  } catch (error) {
    if (error instanceof IntakeValidationError) invalidCount += 1;
    else failures.push(`unknown flag test returned ${(error as Error).name}: ${(error as Error).message}`);
  }

  for (const filename of existsSync('intakes/valid') ? readdirSync('intakes/valid').filter((item) => item.endsWith('.yaml')).sort() : []) {
    const path = join('intakes/valid', filename);
    try {
      planCanonicalIntake(readYaml(path));
      validCount += 1;
    } catch (error) {
      failures.push(`${path}: ${(error as Error).message}`);
    }
  }

  for (const filename of existsSync('intakes/invalid') ? readdirSync('intakes/invalid').filter((item) => item.endsWith('.yaml')).sort() : []) {
    const path = join('intakes/invalid', filename);
    try {
      planCanonicalIntake(readYaml(path));
      failures.push(`${path}: expected canonical intake failure`);
    } catch {
      invalidCount += 1;
    }
  }

  if (failures.length > 0) throw new Error(`Canonical intake fixture checks failed:\n${failures.map((item) => `- ${item}`).join('\n')}`);
  console.log(`Canonical intake fixture checks passed: valid=${validCount}, invalid=${invalidCount}.`);
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed['check-fixtures'] === true) {
    checkFixtures();
    return;
  }
  const file = value(parsed, 'file');
  const rawFromFile = file ? readYaml(file) : {};
  if (rawFromFile === null || typeof rawFromFile !== 'object' || Array.isArray(rawFromFile)) throw new IntakeValidationError('Intake file must contain an object.');
  const raw = { ...(rawFromFile as Dict), ...fromFlags(parsed) };
  const plan = planCanonicalIntake(raw);
  const outIntake = value(parsed, 'out-intake');
  const outCase = value(parsed, 'out-case');
  if (outIntake) writeYaml(outIntake, plan.validatedIntake.normalized_inputs);
  if (outCase) writeYaml(outCase, {
    case_id: `intake.${plan.routing.domain}.${plan.routing.subtype ?? 'default'}.v2`,
    domain: plan.routing.domain,
    subtype: plan.routing.subtype,
    version: plan.generationPlan.contract.version,
    inputs: plan.contract.resolved_inputs,
    expected: { validation: { should_pass: true } },
  });
  console.log(JSON.stringify({
    schema_id: plan.validatedIntake.schema_id,
    intake_digest: plan.validatedIntake.intake_digest,
    domain: plan.routing.domain,
    subtype: plan.routing.subtype,
    routing_method: plan.routing.method,
    contract_path: plan.contract.source_path,
    risk: plan.risk.classification,
    review_required: plan.risk.review_required,
  }, null, 2));
}

const direct = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (direct) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
