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
  type RiskAssessment,
  type RuntimePlanAssessment,
  type ValidatedIntakeEnvelope,
  assertValidatedEnvelope,
  canonicalJson,
  createValidatedIntakeEnvelope,
  sha256File,
  validatedPlans,
  validatedRuntimePlans,
  walkFiles,
} from './runtime-authority-foundation.js';
import { buildRoutingDecision, deriveRisk, seedDomainInputs } from './runtime-authority-risk.js';
import { resolveCanonicalSubtype, templatePathForResolvedSubtype } from './runtime-authority-subtype.js';
import { deriveDelegatedTargetRequest, type DerivedDelegatedTargetRequest } from './runtime-authority-delegation.js';

const RESERVED_DOMAIN_INPUT_FIELDS = new Set([
  'authority_state',
  'contract',
  'contract_id',
  'contract_identity',
  'delegated_target',
  'delegated_target_available',
  'domain',
  'governing_sources',
  'publication',
  'requires_human_review',
  'review_required',
  'review_state',
  'risk',
  'risk_level',
  'rules',
  'subtype',
  'target_domain',
  'target_subtype',
  'template',
  'template_identity',
  'template_path',
  'validators',
]);

interface DelegatedTargetPlanShape extends Dict {
  target_request: string;
  derivation_method: string;
  routing: Dict;
  subtype: string;
  contract: Dict;
  rules: Dict;
  risk: RiskAssessment;
  validators: Dict[];
  template: Dict;
  governing_sources: GoverningSource[];
  required_checks: RequiredCheckDefinition[];
}

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

interface ContractValidationOptions {
  evaluate_conditional_requirements?: boolean;
}

export function resolveAndValidateContract(
  contract: DomainContract,
  provided: Dict,
  options: ContractValidationOptions = {},
): { resolved: Dict; defaulted: string[]; errors: string[] } {
  const resolved: Dict = { ...provided };
  const defaulted: string[] = [];
  const errors: string[] = [];
  const required = contract.fields?.required ?? [];
  const optional = contract.fields?.optional ?? [];
  const inferred = contract.fields?.inferred ?? [];
  for (const field of optional) {
    if (resolved[field.name] === undefined && Object.prototype.hasOwnProperty.call(field, 'default')) {
      resolved[field.name] = structuredClone(field.default);
      defaulted.push(field.name);
    }
  }
  for (const field of inferred) {
    if (resolved[field.name] !== undefined) continue;
    const logic = (field as ContractField & { logic?: string }).logic;
    if (logic) {
      try {
        resolved[field.name] = evaluateConditionForTest(logic, resolved);
      } catch (error) {
        errors.push(`${field.name}: inference evaluation failed: ${(error as Error).message}`);
      }
    } else if (Object.prototype.hasOwnProperty.call(field, 'default')) {
      resolved[field.name] = structuredClone(field.default);
      defaulted.push(field.name);
    }
  }
  for (const field of required) if (resolved[field.name] === undefined || resolved[field.name] === null || resolved[field.name] === '') errors.push(`${field.name}: required`);
  if (options.evaluate_conditional_requirements !== false) for (const field of optional) {
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
    if (combination.severity === 'warning') continue;
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

function compileDomainRules(config: PEaCConfig, domain: string, namespace = ''): AppliedConstraint[] {
  const path = join(config.domains_path, domain, 'rules.yaml');
  if (!existsSync(path)) return [];
  const source = readYamlFile<{ rules?: Dict[] }>(path) ?? {};
  return (source.rules ?? []).map((rule) => {
    const rawId = String(rule.id ?? 'unnamed_domain_rule');
    const text = typeof rule.rule === 'string' ? rule.rule : Array.isArray(rule.rules) ? rule.rules.map(String).join(' ') : '';
    return {
      rule_id: `${namespace}${rawId}`,
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

function sourceRecord(path: string): GoverningSource {
  return { algorithm: 'sha256', path, sha256: sha256File(path) };
}

function callerDomainInputs(envelope: ValidatedIntakeEnvelope, contract: DomainContract): Dict {
  if (envelope.source_mode === 'fixture_validation') return {};
  const raw = envelope.normalized_inputs.domain_inputs;
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('domain_inputs must be an object.');
  const inputs = raw as Dict;
  const known = new Set([
    ...(contract.fields?.required ?? []),
    ...(contract.fields?.optional ?? []),
    ...(contract.fields?.inferred ?? []),
  ].map((field) => field.name));
  for (const key of Object.keys(inputs)) {
    if (RESERVED_DOMAIN_INPUT_FIELDS.has(key)) throw new Error(`domain_inputs cannot override reserved authority field: ${key}`);
    if (!known.has(key)) throw new Error(`Unknown domain_inputs field for selected Domain contract: ${key}`);
  }
  return structuredClone(inputs);
}

function targetEnvelope(
  outer: ValidatedIntakeEnvelope,
  derived: DerivedDelegatedTargetRequest,
  config: PEaCConfig,
): ValidatedIntakeEnvelope {
  const raw: Dict = structuredClone(outer.normalized_inputs);
  raw.request = derived.targetRequest;
  raw.domain_hint = null;
  raw.domain_inputs = derived.targetInputs;
  delete raw.target_request;
  delete raw.target_inputs;
  return createValidatedIntakeEnvelope(raw, 'api_request', config);
}

function buildTargetPlan(
  outer: ValidatedIntakeEnvelope,
  derived: DerivedDelegatedTargetRequest,
  config: PEaCConfig,
): DelegatedTargetPlanShape | null {
  const envelope = targetEnvelope(outer, derived, config);
  const routing = buildRoutingDecision(envelope, config);
  if (routing.domain === 'general') {
    if (derived.explicit) throw new Error('Explicit target_request did not resolve to a specialized target Domain.');
    return null;
  }
  if (routing.domain === 'prompt_generation') throw new Error('Delegated target route cannot resolve back to prompt_generation.');
  const contractPath = join(config.domains_path, routing.domain, 'input.contract.yaml');
  if (!existsSync(contractPath)) throw new Error(`Missing delegated target contract: ${contractPath}`);
  const contractDefinition = readYamlFile<DomainContract>(contractPath) ?? {};
  const provided = {
    ...seedDomainInputs(envelope, routing.domain),
    ...callerDomainInputs(envelope, contractDefinition),
    domain: routing.domain,
  };
  const preliminary = resolveAndValidateContract(contractDefinition, provided, { evaluate_conditional_requirements: false });
  if (preliminary.errors.length > 0) throw new Error(`Delegated target contract validation failed before Subtype resolution: ${preliminary.errors.join('; ')}`);
  const subtype = resolveCanonicalSubtype(config, routing.domain, preliminary.resolved, routing.subtype);
  routing.subtype = subtype.subtype;
  preliminary.resolved.domain = routing.domain;
  preliminary.resolved.subtype = subtype.subtype;
  const validation = resolveAndValidateContract(contractDefinition, preliminary.resolved);
  if (validation.errors.length > 0) throw new Error(`Delegated target contract validation failed after Subtype resolution: ${validation.errors.join('; ')}`);
  validation.resolved.domain = routing.domain;
  validation.resolved.subtype = subtype.subtype;
  const rules = compileDomainRules(config, routing.domain, `target:${routing.domain}:`);
  const failedRules = rules.filter((record) => record.applicable && record.execution_result !== 'applied');
  if (failedRules.length > 0) throw new Error(`Delegated target rule without executable carrier: ${failedRules.map((record) => record.rule_id).join(', ')}`);
  const risk = deriveRisk(envelope, routing, config, validation.resolved);
  const templatePath = templatePathForResolvedSubtype(config, routing.domain, subtype.subtype);
  if (!existsSync(templatePath)) throw new Error(`Delegated target template is unavailable: ${templatePath}`);
  const validators = validatorDefinitions(config, routing.domain);
  const validatorIdentities = validators.checks.map((check) => ({
    check_id: `target:${routing.domain}:${String(check.id ?? 'unnamed_check')}`,
    source_path: validators.path,
    source_sha256: sha256File(validators.path),
  }));
  const governingPaths = [
    contractPath,
    join(config.domains_path, routing.domain, 'route.yaml'),
    join(config.domains_path, routing.domain, 'rules.yaml'),
    validators.path,
    templatePath,
  ].filter((path) => existsSync(path));
  const governingSources = [...new Set(governingPaths)].sort().map(sourceRecord);
  const requiredChecks = [
    { check_id: `target:${routing.domain}:domain_contract` },
    { check_id: `target:${routing.domain}:risk_known` },
    ...rules.filter((record) => record.applicable).map((record) => ({ check_id: `rule:${record.rule_id}` })),
    ...validatorIdentities.map((item) => ({ check_id: item.check_id })),
    ...governingSources.map((item) => ({ check_id: `source:${item.path}` })),
  ].sort((a, b) => a.check_id.localeCompare(b.check_id));
  return {
    target_request: derived.targetRequest,
    derivation_method: derived.derivationMethod,
    routing: routing as unknown as Dict,
    subtype: subtype.subtype,
    contract: {
      id: `${routing.domain}.input-contract`,
      version: String(contractDefinition.contract_version ?? contractDefinition.version ?? 'unknown'),
      source_path: contractPath,
      source_sha256: sha256File(contractPath),
      resolved_inputs: validation.resolved,
      defaulted_inputs: [...new Set([...preliminary.defaulted, ...validation.defaulted])].sort(),
    },
    rules: {
      applicable: rules.filter((record) => record.applicable),
      applied: rules.filter((record) => record.execution_result === 'applied'),
    },
    risk,
    validators: validatorIdentities,
    template: { path: templatePath, sha256: sha256File(templatePath) },
    governing_sources: governingSources,
    required_checks: requiredChecks,
  };
}

function riskRank(value: RiskAssessment['classification']): number {
  if (value === 'clarification_required' || value === 'unknown') return 5;
  if (value === 'high') return 4;
  if (value === 'medium') return 3;
  return 1;
}

function joinRisk(outer: RiskAssessment, target: RiskAssessment): RiskAssessment {
  const classification = riskRank(target.classification) > riskRank(outer.classification) ? target.classification : outer.classification;
  return {
    classification,
    factors: [
      ...outer.factors.map((item) => ({ ...item, factor_id: `outer:${item.factor_id}` })),
      ...target.factors.map((item) => ({ ...item, factor_id: `target:${item.factor_id}` })),
    ].sort((a, b) => a.factor_id.localeCompare(b.factor_id)),
    applied_rules: [
      ...outer.applied_rules.map((item) => ({ ...item, rule_id: `outer:${item.rule_id}` })),
      ...target.applied_rules.map((item) => ({ ...item, rule_id: `target:${item.rule_id}` })),
    ],
    benign_resolution: outer.benign_resolution,
    risk_surface: outer.risk_surface,
    unknowns: [
      ...outer.unknowns.map((item) => `outer:${item}`),
      ...target.unknowns.map((item) => `target:${item}`),
    ].sort(),
    review_required: outer.review_required || target.review_required || ['unknown', 'clarification_required'].includes(classification),
    decision: `conservative delegated risk join: outer=${outer.classification}; target=${target.classification}; final=${classification}`,
    signals: [
      ...outer.signals.map((item) => ({ ...item, id: `outer:${item.id}` })),
      ...target.signals.map((item) => ({ ...item, id: `target:${item.id}` })),
    ],
  };
}

function delegatedTarget(plan: Pick<GenerationPlan, 'routing'> & Dict): DelegatedTargetPlanShape | null {
  const target = plan.delegated_target;
  return target !== null && typeof target === 'object' && !Array.isArray(target) ? target as DelegatedTargetPlanShape : null;
}

function templatePathForPlan(plan: Pick<GenerationPlan, 'routing'> & Dict, config: PEaCConfig): string {
  const delegated = delegatedTarget(plan);
  if (delegated) return String((delegated.template as Dict).path ?? '');
  const subtype = plan.routing.subtype;
  if (!subtype) throw new Error(`Canonical plan has no resolved Subtype for ${plan.routing.domain}.`);
  return templatePathForResolvedSubtype(config, plan.routing.domain, subtype);
}

function expectedCheckDefinitions(plan: Omit<GenerationPlan, 'required_checks'> & Dict, config: PEaCConfig, sources: GoverningSource[]): RequiredCheckDefinition[] {
  const delegated = delegatedTarget(plan);
  const validators = delegated
    ? (delegated.validators as Dict[]).map((check) => String(check.check_id ?? 'unnamed_check'))
    : validatorDefinitions(config, plan.routing.domain).checks.map((check) => String(check.id ?? 'unnamed_check'));
  const targetChecks = delegated
    ? [
        `target:${String((delegated.routing as Dict).domain)}:domain_contract`,
        `target:${String((delegated.routing as Dict).domain)}:risk_known`,
      ]
    : [];
  const policyChecks = plan.policies.applicable.map((item) => `policy:${item.rule_id}`);
  const ruleChecks = plan.rules.applicable.map((item) => `rule:${item.rule_id}`);
  const sourceChecks = sources.map((item) => `source:${item.path}`);
  const ids = [...CORE_CHECK_IDS, ...targetChecks, ...validators, ...policyChecks, ...ruleChecks, ...sourceChecks].sort();
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) throw new Error(`Duplicate logical Check ID: ${[...new Set(duplicates)].join(', ')}`);
  if (ids.length === 0) throw new Error('Canonical required Check set must be non-empty.');
  return ids.map((check_id) => ({ check_id }));
}

export function governingSources(plan: Pick<GenerationPlan, 'routing' | 'contract' | 'policies'> & Dict, config: PEaCConfig): GoverningSource[] {
  const delegated = delegatedTarget(plan);
  const templatePath = templatePathForPlan(plan, config);
  const paths = new Set<string>([
    'peac.config.yaml',
    join(config.pipeline_path, 'intake.schema.json'),
    join(config.pipeline_path, 'artifact.schema.json'),
    delegated ? join(config.pipeline_path, 'runtime-artifact.v2.schema.json') : join(config.pipeline_path, 'runtime-artifact.schema.json'),
    join(config.pipeline_path, 'quality-gates.yaml'),
    join(config.pipeline_path, 'context-policy.yaml'),
    join(config.pipeline_path, 'model-profiles.yaml'),
    plan.contract.source_path,
    join(config.domains_path, plan.routing.domain, 'route.yaml'),
    join(config.domains_path, plan.routing.domain, 'rules.yaml'),
    join(config.domains_path, plan.routing.domain, 'validators.yaml'),
    templatePath,
    ...plan.policies.applied.map((record) => record.source_path),
    ...(delegated?.governing_sources ?? []).map((item) => item.path),
    ...walkFiles('evals').filter((path) => /\.ya?ml$/.test(path)),
  ].filter((path) => path && existsSync(path)));
  return [...paths].sort().map(sourceRecord);
}

function buildPlanCore(envelope: ValidatedIntakeEnvelope, config: PEaCConfig): Omit<GenerationPlan, 'required_checks'> & Dict {
  assertValidatedEnvelope(envelope);
  const routing = buildRoutingDecision(envelope, config);
  const derivation = deriveDelegatedTargetRequest(envelope);
  const targetFieldsPresent = envelope.normalized_inputs.target_request !== undefined
    || (envelope.normalized_inputs.target_inputs !== undefined
      && typeof envelope.normalized_inputs.target_inputs === 'object'
      && envelope.normalized_inputs.target_inputs !== null
      && Object.keys(envelope.normalized_inputs.target_inputs as Dict).length > 0);
  if (routing.domain !== 'prompt_generation' && targetFieldsPresent) throw new Error('target_request and target_inputs are valid only when canonical outer routing selects prompt_generation.');
  if (derivation && routing.domain !== 'prompt_generation') throw new Error(`Registered prompt-generation wrapper resolved outer Domain ${routing.domain}; delegation requires prompt_generation.`);
  const targetPlan = routing.domain === 'prompt_generation' && derivation ? buildTargetPlan(envelope, derivation, config) : null;
  const contractPath = join(config.domains_path, routing.domain, 'input.contract.yaml');
  if (!existsSync(contractPath)) throw new Error(`Missing domain contract: ${contractPath}`);
  const contractDefinition = readYamlFile<DomainContract>(contractPath) ?? {};
  const provided = {
    ...seedDomainInputs(envelope, routing.domain),
    ...callerDomainInputs(envelope, contractDefinition),
    domain: routing.domain,
    ...(routing.domain === 'prompt_generation' ? { delegated_target_available: Boolean(targetPlan) } : {}),
  };
  const preliminary = resolveAndValidateContract(contractDefinition, provided, { evaluate_conditional_requirements: false });
  if (preliminary.errors.length > 0) throw new Error(`Domain contract validation failed before Subtype resolution: ${preliminary.errors.join('; ')}`);
  const subtype = resolveCanonicalSubtype(config, routing.domain, preliminary.resolved, routing.subtype);
  routing.subtype = subtype.subtype;
  preliminary.resolved.domain = routing.domain;
  preliminary.resolved.subtype = subtype.subtype;
  const validation = resolveAndValidateContract(contractDefinition, preliminary.resolved);
  if (validation.errors.length > 0) throw new Error(`Domain contract validation failed after Subtype resolution: ${validation.errors.join('; ')}`);
  validation.resolved.domain = routing.domain;
  validation.resolved.subtype = subtype.subtype;
  const defaultedInputs = [...new Set([...preliminary.defaulted, ...validation.defaulted])].sort();
  const outerRisk = deriveRisk(envelope, routing, config, validation.resolved);
  const risk = targetPlan ? joinRisk(outerRisk, targetPlan.risk) : outerRisk;
  const policyInputs = targetPlan
    ? { ...validation.resolved, ...(targetPlan.contract.resolved_inputs as Dict), target_domain: (targetPlan.routing as Dict).domain, target_subtype: targetPlan.subtype }
    : validation.resolved;
  const policies = compilePolicyConstraints(config, policyInputs);
  const outerRules = compileDomainRules(config, routing.domain, targetPlan ? `outer:${routing.domain}:` : '');
  const rules = targetPlan
    ? [...outerRules, ...((targetPlan.rules.applied as AppliedConstraint[]) ?? [])]
    : outerRules;
  const failedCarriers = [...policies, ...rules].filter((record) => record.applicable && record.execution_result !== 'applied');
  if (failedCarriers.length > 0) throw new Error(`Applicable rule without executable carrier: ${failedCarriers.map((record) => record.rule_id).join(', ')}`);
  const contextItems = Array.isArray(envelope.normalized_inputs.context_items) ? envelope.normalized_inputs.context_items as Dict[] : [];
  const strictness = String(envelope.normalized_inputs.strictness ?? 'precise');
  let intended: AuthorityState = 'authorized';
  if (envelope.source_mode === 'fixture_validation') intended = 'non_authoritative_fixture';
  else if (risk.review_required) intended = 'review_pending';
  return {
    plan_id: 'peac.validated-generation-plan',
    plan_version: targetPlan ? 'generation-plan.v3' : 'generation-plan.v2',
    intake: { schema_id: envelope.schema_id, digest: envelope.intake_digest, normalized_inputs: envelope.normalized_inputs },
    routing,
    risk,
    contract: {
      id: `${routing.domain}.input-contract`,
      version: String(contractDefinition.contract_version ?? contractDefinition.version ?? 'unknown'),
      source_path: contractPath,
      source_sha256: sha256File(contractPath),
      resolved_inputs: validation.resolved,
      defaulted_inputs: defaultedInputs,
    },
    policies: { applicable: policies.filter((record) => record.applicable), applied: policies.filter((record) => record.execution_result === 'applied') },
    rules: { applicable: rules.filter((record) => record.applicable), applied: rules.filter((record) => record.execution_result === 'applied') },
    context: { items: contextItems, attribution_state: contextState(contextItems) },
    evaluation: {
      profile: strictness === 'production-grade' ? 'static_production_profile' : strictness,
      suites: Array.isArray(envelope.normalized_inputs.eval_suite) ? envelope.normalized_inputs.eval_suite.map(String).sort() : [],
      assurance: strictness === 'production-grade' ? 'static_production_profile_validated' : 'static_profile',
    },
    delegated_target: targetPlan,
    publication: { intended_authority_state: intended },
  } as unknown as Omit<GenerationPlan, 'required_checks'> & Dict;
}

function finalizePlan(core: Omit<GenerationPlan, 'required_checks'> & Dict, config: PEaCConfig): { plan: GenerationPlan; sources: GoverningSource[] } {
  const sources = governingSources(core, config);
  const requiredChecks = expectedCheckDefinitions(core, config, sources);
  const plan = { ...core, required_checks: requiredChecks } as unknown as GenerationPlan;
  validatedPlans.add(plan);
  return { plan, sources };
}

export function compileRuntimePlan(envelope: ValidatedIntakeEnvelope, configOverride?: PEaCConfig): RuntimePlanAssessment {
  const config = configOverride ?? loadConfig();
  const { plan, sources } = finalizePlan(buildPlanCore(envelope, config), config);
  const assessment = {
    validatedIntake: envelope,
    routing: plan.routing,
    risk: plan.risk,
    contract: plan.contract,
    policies: plan.policies,
    rules: plan.rules,
    context: plan.context,
    generationPlan: plan,
    requiredChecks: [...plan.required_checks],
    governingSources: sources,
  } as unknown as RuntimePlanAssessment;
  validatedRuntimePlans.add(assessment);
  return assessment;
}

export function compileGenerationPlan(envelope: ValidatedIntakeEnvelope, configOverride?: PEaCConfig): GenerationPlan {
  return compileRuntimePlan(envelope, configOverride).generationPlan;
}
