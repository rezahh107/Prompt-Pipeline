import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateConditionForTest, loadConfig, readYamlFile, type Dict, type PEaCConfig } from './peac.js';
import {
  CORE_CHECK_IDS,
  type AppliedConstraint,
  type AuthorityState,
  type ContractField,
  type DomainContract,
  type DomainValidator,
  type GenerationPlan,
  type GoverningSource,
  type RequiredCheckDefinition,
  type RuntimePlanAssessment,
  type ValidatedIntakeEnvelope,
  assertValidatedEnvelope,
  canonicalJson,
  sha256File,
  validatedPlans,
  validatedRuntimePlans,
  walkFiles,
} from './runtime-authority-foundation.js';
import { buildRoutingDecision, deriveRisk, seedDomainInputs } from './runtime-authority-risk.js';

function typeMatches(value: unknown, expected: string): boolean {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'null') return value === null;
  return typeof value === expected;
}

function validateField(field: ContractField, value: unknown): string[] {
  const errors: string[] = [];
  if (field.type && !typeMatches(value, field.type)) errors.push(`${field.name}: expected ${field.type}`);
  if (field.enum && !field.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(value))) errors.push(`${field.name}: value is not in enum`);
  if (typeof value === 'number' && field.minimum !== undefined && value < field.minimum) errors.push(`${field.name}: below minimum ${field.minimum}`);
  if (typeof value === 'number' && field.maximum !== undefined && value > field.maximum) errors.push(`${field.name}: above maximum ${field.maximum}`);
  if (typeof value === 'string' && field.min_length !== undefined && value.length < field.min_length) errors.push(`${field.name}: below min_length ${field.min_length}`);
  if (typeof value === 'string' && field.max_length !== undefined && value.length > field.max_length) errors.push(`${field.name}: above max_length ${field.max_length}`);
  if (Array.isArray(value)) {
    const itemType = field.item_type ?? field.items?.type;
    if (itemType) value.forEach((item, index) => { if (!typeMatches(item, itemType)) errors.push(`${field.name}[${index}]: expected ${itemType}`); });
    if (field.items?.enum) value.forEach((item, index) => { if (!field.items?.enum?.some((candidate) => canonicalJson(candidate) === canonicalJson(item))) errors.push(`${field.name}[${index}]: value is not in enum`); });
  }
  return errors;
}

export function active(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

export function resolveAndValidateContract(contract: DomainContract, provided: Dict): { resolved: Dict; defaulted: string[]; errors: string[] } {
  const resolved: Dict = { ...provided };
  const defaulted: string[] = [];
  const errors: string[] = [];
  const required = contract.fields?.required ?? [];
  const optional = contract.fields?.optional ?? [];
  const inferred = contract.fields?.inferred ?? [];
  for (const field of [...optional, ...inferred]) {
    if (resolved[field.name] === undefined && Object.prototype.hasOwnProperty.call(field, 'default')) {
      resolved[field.name] = structuredClone(field.default);
      defaulted.push(field.name);
    }
  }
  for (const field of required) if (resolved[field.name] === undefined || resolved[field.name] === null || resolved[field.name] === '') errors.push(`${field.name}: required`);
  for (const field of optional) {
    if (!field.required_if) continue;
    try {
      if (evaluateConditionForTest(field.required_if, resolved) && (resolved[field.name] === undefined || resolved[field.name] === null || resolved[field.name] === '')) errors.push(`${field.name}: required by condition ${field.required_if}`);
    } catch (error) {
      errors.push(`${field.name}: required_if evaluation failed: ${(error as Error).message}`);
    }
  }
  const known = new Set([...required, ...optional, ...inferred].map((field) => field.name));
  if (contract.additional_properties === false) for (const key of Object.keys(resolved)) if (!known.has(key) && key !== 'domain' && key !== 'subtype') errors.push(`${key}: additional property is not allowed`);
  for (const field of [...required, ...optional, ...inferred]) if (resolved[field.name] !== undefined) errors.push(...validateField(field, resolved[field.name]));
  for (const combination of contract.fields?.forbidden_combinations ?? []) {
    if (combination.fields.length > 0 && combination.fields.every((field) => active(resolved[field]))) errors.push(`forbidden combination: ${combination.fields.join(' + ')}${combination.reason ? ` — ${combination.reason}` : ''}`);
  }
  return { resolved, defaulted: defaulted.sort(), errors };
}

export function validateContractForTest(contract: DomainContract, inputs: Dict): { resolved: Dict; defaulted: string[]; errors: string[] } {
  return resolveAndValidateContract(contract, inputs);
}

function compilePolicyConstraints(config: PEaCConfig, inputs: Dict): AppliedConstraint[] {
  const records: AppliedConstraint[] = [];
  for (const path of walkFiles(config.policies_path).filter((file) => /\.ya?ml$/.test(file))) {
    const policy = readYamlFile<Dict>(path) ?? {};
    const id = String(policy.policy_id ?? path);
    const conditions = Array.isArray(policy.applies_when) ? policy.applies_when.map(String) : ['true'];
    let applicable = false;
    const diagnostics: string[] = [];
    try {
      applicable = conditions.some((condition) => condition === 'true' || evaluateConditionForTest(condition, inputs));
    } catch (error) {
      applicable = true;
      diagnostics.push(`condition evaluation failed: ${(error as Error).message}`);
    }
    const rules = Array.isArray(policy.rules) ? policy.rules.map(String) : [];
    records.push({
      rule_id: id,
      source_path: path,
      source_sha256: sha256File(path),
      applicable,
      trigger_evidence: conditions,
      carrier: 'template_constraint',
      enforcement_kind: 'template_constraint',
      execution_result: applicable && rules.length > 0 && diagnostics.length === 0 ? 'applied' : applicable ? 'failed' : 'not_applicable',
      diagnostics: applicable && rules.length === 0 ? [...diagnostics, 'Applicable policy has no executable rule carrier.'] : diagnostics,
      constraint_text: rules.join(' '),
    });
  }
  return records;
}

function compileDomainRules(config: PEaCConfig, domain: string): AppliedConstraint[] {
  const path = join(config.domains_path, domain, 'rules.yaml');
  if (!existsSync(path)) return [];
  const source = readYamlFile<{ rules?: Dict[] }>(path) ?? {};
  return (source.rules ?? []).map((rule) => {
    const text = typeof rule.rule === 'string' ? rule.rule : Array.isArray(rule.rules) ? rule.rules.map(String).join(' ') : '';
    return {
      rule_id: String(rule.id ?? 'unnamed_domain_rule'),
      source_path: path,
      source_sha256: sha256File(path),
      applicable: true,
      trigger_evidence: ['selected_domain'],
      carrier: 'template_constraint' as const,
      enforcement_kind: 'template_constraint',
      execution_result: text ? 'applied' as const : 'failed' as const,
      diagnostics: text ? [] : ['Applicable domain rule has no executable rule carrier.'],
      constraint_text: text,
    };
  });
}

function contextState(items: Dict[]): GenerationPlan['context']['attribution_state'] {
  const states = new Set(items.map((item) => String(item.attribution_state ?? 'unknown')));
  if (states.has('untrusted')) return 'untrusted';
  if (states.has('unknown')) return 'unknown';
  if (states.has('source_bound')) return 'source_bound';
  return 'manual_attributed';
}

export function validatorDefinitions(config: PEaCConfig, domain: string): { path: string; checks: DomainValidator[] } {
  const path = join(config.domains_path, domain, 'validators.yaml');
  const source = existsSync(path) ? readYamlFile<{ static_checks?: DomainValidator[] }>(path) : null;
  return { path, checks: source?.static_checks ?? [] };
}

function expectedCheckDefinitions(plan: Omit<GenerationPlan, 'required_checks'>, config: PEaCConfig, sources: GoverningSource[]): RequiredCheckDefinition[] {
  const validators = validatorDefinitions(config, plan.routing.domain).checks.map((check) => String(check.id ?? 'unnamed_check'));
  const policyChecks = plan.policies.applicable.map((item) => `policy:${item.rule_id}`);
  const ruleChecks = plan.rules.applicable.map((item) => `rule:${item.rule_id}`);
  const sourceChecks = sources.map((item) => `source:${item.path}`);
  const ids = [...CORE_CHECK_IDS, ...validators, ...policyChecks, ...ruleChecks, ...sourceChecks].sort();
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) throw new Error(`Duplicate logical Check ID: ${[...new Set(duplicates)].join(', ')}`);
  if (ids.length === 0) throw new Error('Canonical required Check set must be non-empty.');
  return ids.map((check_id) => ({ check_id }));
}

function templatePathForPlan(plan: Pick<GenerationPlan, 'routing'>, config: PEaCConfig): string | null {
  const routePath = join(config.domains_path, plan.routing.domain, 'route.yaml');
  if (!existsSync(routePath)) return null;
  const route = readYamlFile<{ subtypes?: Array<{ id?: string; templates?: { primary?: string } }> }>(routePath) ?? {};
  const subtype = plan.routing.subtype ?? route.subtypes?.[0]?.id ?? 'default';
  const template = route.subtypes?.find((item) => item.id === subtype)?.templates?.primary ?? route.subtypes?.[0]?.templates?.primary;
  if (!template) return null;
  return join(config.domains_path, plan.routing.domain, 'templates', template);
}

function sourceRecord(path: string): GoverningSource {
  return { algorithm: 'sha256', path, sha256: sha256File(path) };
}

export function governingSources(plan: Pick<GenerationPlan, 'routing' | 'contract' | 'policies'>, config: PEaCConfig): GoverningSource[] {
  const templatePath = templatePathForPlan(plan, config);
  const paths = new Set<string>([
    'peac.config.yaml',
    join(config.pipeline_path, 'intake.schema.json'),
    join(config.pipeline_path, 'artifact.schema.json'),
    join(config.pipeline_path, 'runtime-artifact.schema.json'),
    join(config.pipeline_path, 'quality-gates.yaml'),
    join(config.pipeline_path, 'context-policy.yaml'),
    join(config.pipeline_path, 'model-profiles.yaml'),
    plan.contract.source_path,
    join(config.domains_path, plan.routing.domain, 'route.yaml'),
    join(config.domains_path, plan.routing.domain, 'rules.yaml'),
    join(config.domains_path, plan.routing.domain, 'validators.yaml'),
    templatePath ?? '',
    ...plan.policies.applied.map((record) => record.source_path),
    ...walkFiles('evals').filter((path) => /\.ya?ml$/.test(path)),
  ].filter((path) => path && existsSync(path)));
  return [...paths].sort().map(sourceRecord);
}

function buildPlanCore(envelope: ValidatedIntakeEnvelope, config: PEaCConfig): Omit<GenerationPlan, 'required_checks'> {
  assertValidatedEnvelope(envelope);
  const routing = buildRoutingDecision(envelope, config);
  const contractPath = join(config.domains_path, routing.domain, 'input.contract.yaml');
  if (!existsSync(contractPath)) throw new Error(`Missing domain contract: ${contractPath}`);
  const contractDefinition = readYamlFile<DomainContract>(contractPath) ?? {};
  const provided = seedDomainInputs(envelope, routing.domain);
  provided.domain = routing.domain;
  const validation = resolveAndValidateContract(contractDefinition, provided);
  if (validation.errors.length > 0) throw new Error(`Domain contract validation failed: ${validation.errors.join('; ')}`);
  validation.resolved.domain = routing.domain;
  const risk = deriveRisk(envelope, routing, config, validation.resolved);
  const policies = compilePolicyConstraints(config, validation.resolved);
  const rules = compileDomainRules(config, routing.domain);
  const failedCarriers = [...policies, ...rules].filter((record) => record.applicable && record.execution_result !== 'applied');
  if (failedCarriers.length > 0) throw new Error(`Applicable rule without executable carrier: ${failedCarriers.map((record) => record.rule_id).join(', ')}`);
  const contextItems = Array.isArray(envelope.normalized_inputs.context_items) ? envelope.normalized_inputs.context_items as Dict[] : [];
  const strictness = String(envelope.normalized_inputs.strictness ?? 'precise');
  let intended: AuthorityState = 'authorized';
  if (envelope.source_mode === 'fixture_validation') intended = 'non_authoritative_fixture';
  else if (risk.review_required) intended = 'review_pending';
  return {
    plan_id: 'peac.validated-generation-plan',
    plan_version: 'generation-plan.v2',
    intake: { schema_id: envelope.schema_id, digest: envelope.intake_digest, normalized_inputs: envelope.normalized_inputs },
    routing,
    risk,
    contract: {
      id: `${routing.domain}.input-contract`,
      version: String(contractDefinition.contract_version ?? contractDefinition.version ?? 'unknown'),
      source_path: contractPath,
      source_sha256: sha256File(contractPath),
      resolved_inputs: validation.resolved,
      defaulted_inputs: validation.defaulted,
    },
    policies: { applicable: policies.filter((record) => record.applicable), applied: policies.filter((record) => record.execution_result === 'applied') },
    rules: { applicable: rules.filter((record) => record.applicable), applied: rules.filter((record) => record.execution_result === 'applied') },
    context: { items: contextItems, attribution_state: contextState(contextItems) },
    evaluation: {
      profile: strictness === 'production-grade' ? 'static_production_profile' : strictness,
      suites: Array.isArray(envelope.normalized_inputs.eval_suite) ? envelope.normalized_inputs.eval_suite.map(String).sort() : [],
      assurance: strictness === 'production-grade' ? 'static_production_profile_validated' : 'static_profile',
    },
    publication: { intended_authority_state: intended },
  };
}

function finalizePlan(core: Omit<GenerationPlan, 'required_checks'>, config: PEaCConfig): { plan: GenerationPlan; sources: GoverningSource[] } {
  const sources = governingSources(core, config);
  const requiredChecks = expectedCheckDefinitions(core, config, sources);
  const plan: GenerationPlan = { ...core, required_checks: requiredChecks };
  validatedPlans.add(plan);
  return { plan, sources };
}

export function compileRuntimePlan(envelope: ValidatedIntakeEnvelope, configOverride?: PEaCConfig): RuntimePlanAssessment {
  const config = configOverride ?? loadConfig();
  const { plan, sources } = finalizePlan(buildPlanCore(envelope, config), config);
  const assessment: RuntimePlanAssessment = {
    validatedIntake: envelope,
    routing: plan.routing,
    risk: plan.risk,
    contract: plan.contract,
    policies: plan.policies,
    rules: plan.rules,
    context: plan.context,
    generationPlan: plan,
    requiredChecks: plan.required_checks,
    governingSources: sources,
  };
  validatedRuntimePlans.add(assessment);
  return assessment;
}

export function compileGenerationPlan(envelope: ValidatedIntakeEnvelope, configOverride?: PEaCConfig): GenerationPlan {
  return compileRuntimePlan(envelope, configOverride).generationPlan;
}
