import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';
import {
  evaluateConditionForTest,
  generateArtifact as generateLegacyFixtureArtifact,
  loadConfig,
  readYamlFile,
  routeRequestForTest,
  type Dict,
  type ExecutionMode,
  type PEaCConfig,
} from './peac.js';

export type SourceMode = 'interactive_request' | 'api_request' | 'fixture_validation';
export type AuthorityState = 'authorized' | 'review_pending' | 'rejected' | 'non_authoritative_fixture';
export type DerivedRisk = 'low' | 'medium' | 'high' | 'unknown' | 'clarification_required';
export type VerificationStatus = 'verified' | 'rejected' | 'insufficient_evidence';

export interface ValidatedIntakeEnvelope {
  schema_id: 'peac.validated-intake';
  schema_version: 'validated-intake.v1';
  intake_digest: string;
  raw_request_digest: string;
  normalized_inputs: Dict;
  source_mode: SourceMode;
  validation: {
    passed: true;
    schema_path: string;
    diagnostics: string[];
  };
  producer: {
    name: 'peac-canonical-intake';
    version: string;
  };
}

export interface RiskAssessment {
  classification: DerivedRisk;
  signals: Array<{ id: string; value: string | boolean | number; source: 'derived' | 'caller_hint' }>;
  unknowns: string[];
  decision: string;
  review_required: boolean;
}

export interface RoutingDecision {
  domain: string;
  subtype: string | null;
  method: string;
  candidates: Array<{ domain: string; confidence: number }>;
  confidence: number;
  fallback_used: boolean;
}

export interface AppliedConstraint {
  rule_id: string;
  source_path: string;
  source_sha256: string;
  applicable: boolean;
  trigger_evidence: string[];
  carrier: 'template_constraint' | 'validator_check' | 'risk_signal' | 'review_requirement' | 'output_requirement' | 'context_restriction';
  enforcement_kind: string;
  execution_result: 'applied' | 'not_applicable' | 'failed';
  diagnostics: string[];
  constraint_text?: string;
}

export interface ValidationCheckRecord {
  check_id: string;
  source: string;
  applicable: boolean;
  executed: boolean;
  passed: boolean | null;
  blocking: boolean;
  diagnostics: string[];
  evidence: Dict;
}

export interface GenerationPlan {
  plan_id: 'peac.validated-generation-plan';
  plan_version: 'generation-plan.v1';
  intake: {
    schema_id: string;
    digest: string;
    normalized_inputs: Dict;
  };
  routing: RoutingDecision;
  risk: RiskAssessment;
  contract: {
    id: string;
    version: string;
    source_path: string;
    source_sha256: string;
    resolved_inputs: Dict;
    defaulted_inputs: string[];
  };
  policies: {
    applicable: AppliedConstraint[];
    applied: AppliedConstraint[];
  };
  rules: {
    applicable: AppliedConstraint[];
    applied: AppliedConstraint[];
  };
  context: {
    items: Dict[];
    attribution_state: 'manual_attributed' | 'source_bound' | 'unknown' | 'untrusted';
  };
  evaluation: {
    profile: string;
    suites: string[];
    assurance: 'static_production_profile' | 'static_production_profile_validated' | 'static_profile';
  };
  required_checks: Array<{ check_id: string }>;
  publication: {
    intended_authority_state: AuthorityState;
  };
}

export interface RuntimeArtifactEnvelope {
  schema_id: 'peac.runtime-artifact-envelope';
  schema_version: 'runtime-artifact-envelope.v1';
  artifact_sha256: string;
  artifact: Dict;
  authorization: {
    authority_state: AuthorityState;
    downstream_use_allowed: boolean;
    review_required: boolean;
    review_receipt: ArtifactReviewReceipt | null;
    diagnostics: string[];
  };
  envelope_sha256: string;
}

export interface ArtifactReviewReceipt {
  receipt_type: 'artifact_review';
  receipt_version: 'artifact-review.v1';
  artifact_sha256: string;
  reviewer: 'owner';
  decision: 'approved' | 'rejected';
  reviewed_at: string;
  limitations: string[];
}

export interface VerificationResult {
  verification_status: VerificationStatus;
  artifact_sha256: string | null;
  authority_state: AuthorityState | null;
  downstream_use_allowed: boolean;
  checks: ValidationCheckRecord[];
  diagnostics: string[];
}

interface ContractField {
  name: string;
  type?: string;
  enum?: unknown[];
  default?: unknown;
  required_if?: string;
  minimum?: number;
  maximum?: number;
  min_length?: number;
  max_length?: number;
  items?: { type?: string; enum?: unknown[] };
  item_type?: string;
}

interface DomainContract {
  contract_version?: string;
  domain?: string;
  version?: string;
  additional_properties?: boolean;
  fields?: {
    required?: ContractField[];
    optional?: ContractField[];
    inferred?: ContractField[];
    forbidden_combinations?: Array<{ fields: string[]; reason?: string; action?: string; severity?: string }>;
  };
}

interface CaseFile {
  case_id?: string;
  description?: string;
  domain: string;
  subtype?: string;
  version?: string;
  inputs: Dict;
}

const validatedEnvelopes = new WeakSet<object>();
const validatedPlans = new WeakSet<object>();
const RISK_BOOLEAN_FIELDS = [
  'sensitive_or_high_risk',
  'uses_external_tools',
  'legal_medical_financial',
  'requires_current_information',
  'exact_factual_claims',
  'external_files',
] as const;
const HIGH_STAKES_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: 'medical_request', regex: /\b(medical|medicine|diagnos(?:is|e)|treatment|prescription|symptom|health advice)\b|پزشک|پزشکی|تشخیص|درمان|دارو|نسخه/i },
  { id: 'legal_request', regex: /\b(legal|lawyer|lawsuit|contract advice|legal advice|court filing)\b|حقوقی|وکیل|دادگاه|شکایت|قرارداد حقوقی/i },
  { id: 'financial_request', regex: /\b(financial advice|investment advice|tax advice|securities|portfolio recommendation)\b|مشاوره مالی|سرمایه.?گذاری|مالیات|بورس/i },
  { id: 'safety_sensitive_request', regex: /\b(safety-critical|dangerous operation|hazardous|irreversible action)\b|ایمنی.?حیاتی|خطرناک|برگشت.?ناپذیر/i },
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const result: Dict = {};
    for (const key of Object.keys(value as Dict).sort()) result[key] = canonicalize((value as Dict)[key]);
    return result;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Json(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

function sha256File(path: string): string {
  return sha256Text(readFileSync(path, 'utf8'));
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
}

function parseDataFile(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  if (extname(path).toLowerCase() === '.json') return JSON.parse(text) as unknown;
  return yaml.load(text) as unknown;
}

function normalizeContextItems(value: unknown): Dict[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const source = item !== null && typeof item === 'object' && !Array.isArray(item) ? item as Dict : {};
    const declared = String(source.trust_level ?? 'unknown');
    const attributionState = declared === 'untrusted' ? 'untrusted' : declared === 'unknown' ? 'unknown' : 'manual_attributed';
    return { ...source, declared_trust_level: declared, attribution_state: attributionState };
  });
}

function normalizeIntake(value: Dict): Dict {
  const copy: Dict = { ...value };
  copy.context_items = normalizeContextItems(value.context_items);
  if (Array.isArray(value.constraints)) copy.constraints = [...value.constraints].map(String).sort();
  if (Array.isArray(value.available_sources)) copy.available_sources = [...value.available_sources].map(String).sort();
  if (Array.isArray(value.success_criteria)) copy.success_criteria = [...value.success_criteria].map(String);
  if (Array.isArray(value.failure_modes)) copy.failure_modes = [...value.failure_modes].map(String);
  if (Array.isArray(value.eval_suite)) copy.eval_suite = [...value.eval_suite].map(String).sort();
  return canonicalize(copy) as Dict;
}

function schemaValidateIntake(raw: unknown, config: PEaCConfig): Dict {
  const schemaPath = join(config.pipeline_path, 'intake.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
  const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const clone = structuredClone(raw);
  if (!validate(clone)) throw new Error(`Intake validation failed: ${formatAjvErrors(validate.errors).join('; ')}`);
  if (clone === null || typeof clone !== 'object' || Array.isArray(clone)) throw new Error('Intake must be an object.');
  return clone as Dict;
}

export function createValidatedIntakeEnvelope(raw: unknown, sourceMode: Exclude<SourceMode, 'fixture_validation'>, configOverride?: PEaCConfig): ValidatedIntakeEnvelope {
  const config = configOverride ?? loadConfig();
  const validated = schemaValidateIntake(raw, config);
  const normalizedInputs = normalizeIntake(validated);
  const request = String(normalizedInputs.request ?? '');
  const envelope: ValidatedIntakeEnvelope = {
    schema_id: 'peac.validated-intake',
    schema_version: 'validated-intake.v1',
    intake_digest: sha256Json(normalizedInputs),
    raw_request_digest: sha256Text(request),
    normalized_inputs: normalizedInputs,
    source_mode: sourceMode,
    validation: {
      passed: true,
      schema_path: join(config.pipeline_path, 'intake.schema.json'),
      diagnostics: [],
    },
    producer: {
      name: 'peac-canonical-intake',
      version: config.version ?? 'dev',
    },
  };
  validatedEnvelopes.add(envelope);
  return envelope;
}

export function createFixtureEnvelope(caseFilePath: string, configOverride?: PEaCConfig): ValidatedIntakeEnvelope {
  const config = configOverride ?? loadConfig();
  const caseData = parseDataFile(caseFilePath) as CaseFile;
  if (!caseData || typeof caseData !== 'object' || !caseData.domain || !caseData.inputs) throw new Error(`Invalid case fixture: ${caseFilePath}`);
  const normalizedInputs = canonicalize({
    request: caseData.description ?? caseData.case_id ?? `fixture:${caseData.domain}`,
    desired_output: 'fixture validation only',
    target_environment: 'Local',
    strictness: 'precise',
    domain_hint: caseData.domain,
    fixture_subtype: caseData.subtype ?? null,
    fixture_inputs: caseData.inputs,
    context_items: [],
  }) as Dict;
  const envelope: ValidatedIntakeEnvelope = {
    schema_id: 'peac.validated-intake',
    schema_version: 'validated-intake.v1',
    intake_digest: sha256Json(normalizedInputs),
    raw_request_digest: sha256File(caseFilePath),
    normalized_inputs: normalizedInputs,
    source_mode: 'fixture_validation',
    validation: {
      passed: true,
      schema_path: join(config.pipeline_path, 'intake.schema.json'),
      diagnostics: ['Fixture mode is non-authoritative and cannot authorize downstream use.'],
    },
    producer: {
      name: 'peac-canonical-intake',
      version: config.version ?? 'dev',
    },
  };
  validatedEnvelopes.add(envelope);
  return envelope;
}

function assertValidatedEnvelope(envelope: ValidatedIntakeEnvelope): void {
  if (!validatedEnvelopes.has(envelope)) throw new Error('ValidatedIntakeEnvelope must be produced by the canonical intake processor in this process.');
  if (sha256Json(envelope.normalized_inputs) !== envelope.intake_digest) throw new Error('ValidatedIntakeEnvelope intake digest mismatch.');
  const request = String(envelope.normalized_inputs.request ?? '');
  if (envelope.source_mode !== 'fixture_validation' && sha256Text(request) !== envelope.raw_request_digest) throw new Error('ValidatedIntakeEnvelope raw request digest mismatch.');
}

function buildRoutingDecision(envelope: ValidatedIntakeEnvelope, config: PEaCConfig): RoutingDecision {
  const intake = envelope.normalized_inputs;
  const request = String(intake.request ?? '');
  const hint = typeof intake.domain_hint === 'string' ? intake.domain_hint : null;
  const routed = routeRequestForTest(request, config);
  const domain = hint ?? routed.domain;
  return {
    domain,
    subtype: typeof intake.fixture_subtype === 'string' ? intake.fixture_subtype : routed.subtype,
    method: hint ? 'validated_domain_hint' : routed.method,
    candidates: routed.evidence?.competing_candidates?.map((candidate) => ({ domain: candidate.domain, confidence: candidate.confidence })) ?? [],
    confidence: hint ? 1 : routed.confidence,
    fallback_used: domain === 'general' || routed.method.includes('fallback'),
  };
}

function booleanHint(intake: Dict, field: string): boolean | null {
  return typeof intake[field] === 'boolean' ? intake[field] as boolean : null;
}

export function deriveRisk(envelope: ValidatedIntakeEnvelope, routing: RoutingDecision): RiskAssessment {
  assertValidatedEnvelope(envelope);
  const intake = envelope.normalized_inputs;
  const request = String(intake.request ?? '');
  const signals: RiskAssessment['signals'] = [];
  const unknowns: string[] = [];
  let rank = 1;
  for (const pattern of HIGH_STAKES_PATTERNS) {
    if (pattern.regex.test(request)) {
      signals.push({ id: pattern.id, value: true, source: 'derived' });
      rank = 3;
    }
  }
  for (const field of RISK_BOOLEAN_FIELDS) {
    const value = booleanHint(intake, field);
    if (value === null) unknowns.push(field);
    else {
      signals.push({ id: field, value, source: 'caller_hint' });
      if (value && ['sensitive_or_high_risk', 'uses_external_tools', 'legal_medical_financial'].includes(field)) rank = 3;
      else if (value) rank = Math.max(rank, 2);
    }
  }
  if (Array.isArray(intake.available_sources) && intake.available_sources.length > 0) {
    signals.push({ id: 'available_external_sources', value: intake.available_sources.length, source: 'derived' });
    rank = Math.max(rank, 2);
  }
  if (routing.domain === 'repo_review' || routing.domain === 'coding_debugging' || routing.domain === 'ai_workflow_design') {
    signals.push({ id: 'potential_downstream_execution', value: true, source: 'derived' });
    rank = Math.max(rank, 2);
  }
  let classification: DerivedRisk = rank === 3 ? 'high' : rank === 2 ? 'medium' : 'low';
  if (unknowns.length > 0 && rank < 3) classification = 'unknown';
  if (routing.domain === 'general' && classification !== 'low') classification = 'clarification_required';
  const reviewRequired = classification === 'high' || classification === 'unknown' || classification === 'clarification_required' || intake.human_review_required === true;
  return {
    classification,
    signals,
    unknowns: unknowns.sort(),
    decision: classification === 'clarification_required'
      ? 'general.max_risk_level prevents automatic authorization'
      : classification === 'unknown'
        ? 'missing consequential risk evidence remains unknown'
        : `runtime-derived ${classification} risk`,
    review_required: reviewRequired,
  };
}

function baseInputs(intake: Dict): Dict {
  return Object.fromEntries(Object.entries({
    output_language: intake.output_language,
    prompt_language: intake.prompt_language,
    explanation_language: intake.explanation_language,
    target_output_language: intake.target_output_language,
    target_model: intake.target_environment,
    available_sources: intake.available_sources,
    constraints: intake.constraints,
    success_criteria: intake.success_criteria,
    failure_modes: intake.failure_modes,
    eval_suite: intake.eval_suite,
    requires_current_information: intake.requires_current_information,
    uses_external_tools: intake.uses_external_tools,
    sensitive_or_high_risk: intake.sensitive_or_high_risk,
    requires_structured_output: intake.requires_structured_output,
    human_review_required: intake.human_review_required,
  }).filter(([, value]) => value !== undefined));
}

function seedDomainInputs(envelope: ValidatedIntakeEnvelope, domain: string): Dict {
  const intake = envelope.normalized_inputs;
  if (envelope.source_mode === 'fixture_validation') return { ...((intake.fixture_inputs as Dict | undefined) ?? {}) };
  const common = baseInputs(intake);
  if (domain === 'prompt_generation') return {
    ...common,
    model_profile: intake.model_profile,
    context_policy: intake.context_policy,
    context_budget_tokens: intake.context_budget_tokens,
    context_items: intake.context_items,
    task: intake.request,
    desired_output: intake.desired_output,
    target_environment: intake.target_environment,
    strictness: intake.strictness,
    user_constraints: Array.isArray(intake.constraints) && intake.constraints.length > 0 ? intake.constraints.join('\n') : 'No extra constraints provided.',
  };
  if (domain === 'document_review') return {
    ...common,
    documents_description: intake.request,
    review_objective: intake.desired_output,
    desired_output: intake.desired_output,
    requires_current_research: intake.requires_current_information,
    external_files: Array.isArray(intake.available_sources) && intake.available_sources.length > 0,
  };
  if (domain === 'ai_workflow_design') return {
    ...common,
    workflow_goal: intake.request,
    operating_context: intake.target_environment,
    target_environment: intake.target_environment,
    desired_artifacts: intake.desired_output,
  };
  if (domain === 'multimodal') return {
    ...common,
    multimodal_task: intake.request,
    asset_types: Array.isArray(intake.available_sources) && intake.available_sources.length > 0 ? intake.available_sources.join(', ') : 'unspecified',
    desired_output: intake.desired_output,
  };
  return { ...common, task: intake.request, output_format: intake.desired_output };
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

function active(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

function resolveAndValidateContract(contract: DomainContract, provided: Dict): { resolved: Dict; defaulted: string[]; errors: string[] } {
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
  for (const field of required) {
    if (resolved[field.name] === undefined || resolved[field.name] === null || resolved[field.name] === '') errors.push(`${field.name}: required`);
  }
  for (const field of optional) {
    if (field.required_if && evaluateConditionForTest(field.required_if, resolved) && (resolved[field.name] === undefined || resolved[field.name] === null || resolved[field.name] === '')) errors.push(`${field.name}: required by condition ${field.required_if}`);
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

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(path));
    else result.push(path);
  }
  return result;
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
      execution_result: applicable && rules.length > 0 ? 'applied' : applicable ? 'failed' : 'not_applicable',
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

export function compileGenerationPlan(envelope: ValidatedIntakeEnvelope, configOverride?: PEaCConfig): GenerationPlan {
  assertValidatedEnvelope(envelope);
  const config = configOverride ?? loadConfig();
  const routing = buildRoutingDecision(envelope, config);
  const risk = deriveRisk(envelope, routing);
  const contractPath = join(config.domains_path, routing.domain, 'input.contract.yaml');
  if (!existsSync(contractPath)) throw new Error(`Missing domain contract: ${contractPath}`);
  const contract = readYamlFile<DomainContract>(contractPath) ?? {};
  const provided = seedDomainInputs(envelope, routing.domain);
  provided.domain = routing.domain;
  const validation = resolveAndValidateContract(contract, provided);
  if (validation.errors.length > 0) throw new Error(`Domain contract validation failed: ${validation.errors.join('; ')}`);
  validation.resolved.domain = routing.domain;
  const policies = compilePolicyConstraints(config, validation.resolved);
  const rules = compileDomainRules(config, routing.domain);
  const failedCarriers = [...policies, ...rules].filter((record) => record.applicable && record.execution_result === 'failed');
  if (failedCarriers.length > 0) throw new Error(`Applicable rule without executable carrier: ${failedCarriers.map((record) => record.rule_id).join(', ')}`);
  const contextItems = Array.isArray(envelope.normalized_inputs.context_items) ? envelope.normalized_inputs.context_items as Dict[] : [];
  const strictness = String(envelope.normalized_inputs.strictness ?? 'precise');
  const assurance = strictness === 'production-grade' ? 'static_production_profile_validated' : 'static_profile';
  let intended: AuthorityState = 'authorized';
  if (envelope.source_mode === 'fixture_validation') intended = 'non_authoritative_fixture';
  else if (risk.review_required) intended = 'review_pending';
  const plan: GenerationPlan = {
    plan_id: 'peac.validated-generation-plan',
    plan_version: 'generation-plan.v1',
    intake: {
      schema_id: envelope.schema_id,
      digest: envelope.intake_digest,
      normalized_inputs: envelope.normalized_inputs,
    },
    routing,
    risk,
    contract: {
      id: `${routing.domain}.input-contract`,
      version: String(contract.contract_version ?? contract.version ?? 'unknown'),
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
      assurance,
    },
    required_checks: [
      { check_id: 'canonical_intake_digest' },
      { check_id: 'domain_contract' },
      { check_id: 'runtime_risk_derivation' },
      { check_id: 'policy_rule_carriers' },
      { check_id: 'legacy_static_validation' },
      { check_id: 'artifact_integrity' },
    ],
    publication: { intended_authority_state: intended },
  };
  validatedPlans.add(plan);
  return plan;
}

function assertValidatedPlan(plan: GenerationPlan): void {
  if (!validatedPlans.has(plan)) throw new Error('ValidatedGenerationPlan must be compiled by the Runtime.');
  if (sha256Json(plan.intake.normalized_inputs) !== plan.intake.digest) throw new Error('Generation plan intake digest mismatch.');
}

function actualCheckoutSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function expectedTestedSha(): string | null {
  const value = process.env.EXPECTED_TESTED_SHA ?? process.env.GITHUB_SHA ?? null;
  return value && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null;
}

function absoluteConfig(config: PEaCConfig, outputPath: string): PEaCConfig {
  return {
    ...config,
    kb_path: resolve(config.kb_path),
    policies_path: resolve(config.policies_path),
    domains_path: resolve(config.domains_path),
    pipeline_path: resolve(config.pipeline_path),
    outputs_path: outputPath,
    artifact: { ...config.artifact, schema: resolve(config.artifact.schema), output_dir: outputPath },
  };
}

function renderThroughStagedLegacy(plan: GenerationPlan, mode: ExecutionMode, config: PEaCConfig): Dict {
  assertValidatedPlan(plan);
  const stagingRoot = resolve(config.outputs_path, '.runtime-staging');
  mkdirSync(stagingRoot, { recursive: true });
  const workspace = mkdtempSync(join(stagingRoot, 'render-'));
  const outputDir = join(workspace, 'legacy-output');
  mkdirSync(outputDir, { recursive: true });
  const casePath = join(workspace, 'canonical.case.yaml');
  writeFileSync(casePath, yaml.dump({
    case_id: `runtime.${plan.routing.domain}.${randomUUID()}`,
    description: String(plan.intake.normalized_inputs.request ?? ''),
    domain: plan.routing.domain,
    subtype: plan.routing.subtype ?? undefined,
    version: config.version ?? 'dev',
    inputs: plan.contract.resolved_inputs,
    expected: { validation: { should_pass: true } },
  }, { lineWidth: 120, noRefs: true }));
  const runtimeConfig = absoluteConfig(config, outputDir);
  writeFileSync(join(workspace, 'peac.config.yaml'), yaml.dump(runtimeConfig, { lineWidth: 120, noRefs: true }));
  const previousCwd = process.cwd();
  try {
    process.chdir(workspace);
    const result = generateLegacyFixtureArtifact({ case: casePath, mode });
    return result.artifact as unknown as Dict;
  } finally {
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
  }
}

function enforceConstraints(prompt: string, plan: GenerationPlan): string {
  const constraints = [...plan.policies.applied, ...plan.rules.applied]
    .map((record) => record.constraint_text?.trim())
    .filter((value): value is string => Boolean(value));
  if (constraints.length === 0) return prompt;
  const lines = constraints.map((constraint, index) => `${index + 1}. ${constraint}`);
  return `${prompt.trim()}\n\n## Runtime-enforced constraints\n${lines.join('\n')}\n`;
}

function structuredLedger(legacyArtifact: Dict, plan: GenerationPlan, config: PEaCConfig, renderedPrompt: string): ValidationCheckRecord[] {
  const records: ValidationCheckRecord[] = [];
  const add = (record: ValidationCheckRecord): void => { records.push(record); };
  add({
    check_id: 'canonical_intake_digest', source: plan.intake.schema_id, applicable: true, executed: true,
    passed: sha256Json(plan.intake.normalized_inputs) === plan.intake.digest, blocking: true, diagnostics: [], evidence: { intake_digest: plan.intake.digest },
  });
  add({
    check_id: 'domain_contract', source: plan.contract.source_path, applicable: true, executed: true, passed: true, blocking: true,
    diagnostics: [], evidence: { source_sha256: plan.contract.source_sha256, resolved_inputs_sha256: sha256Json(plan.contract.resolved_inputs) },
  });
  add({
    check_id: 'runtime_risk_derivation', source: 'src/runtime-authority.ts', applicable: true, executed: true,
    passed: true, blocking: true, diagnostics: plan.risk.unknowns.map((field) => `unknown:${field}`), evidence: { classification: plan.risk.classification, signals: plan.risk.signals },
  });
  const carrierFailures = [...plan.policies.applicable, ...plan.rules.applicable].filter((record) => record.execution_result !== 'applied');
  add({
    check_id: 'policy_rule_carriers', source: 'compiled_policy_and_domain_rules', applicable: true, executed: true,
    passed: carrierFailures.length === 0, blocking: true, diagnostics: carrierFailures.flatMap((record) => record.diagnostics),
    evidence: { applied_policy_ids: plan.policies.applied.map((record) => record.rule_id), applied_rule_ids: plan.rules.applied.map((record) => record.rule_id) },
  });
  const legacyValidation = legacyArtifact.validation !== null && typeof legacyArtifact.validation === 'object' ? legacyArtifact.validation as Dict : {};
  const legacyPassed = legacyValidation.passed === true;
  const validatorsPath = join(config.domains_path, plan.routing.domain, 'validators.yaml');
  const validators = existsSync(validatorsPath) ? readYamlFile<{ static_checks?: Dict[] }>(validatorsPath) : null;
  for (const check of validators?.static_checks ?? []) {
    const id = String(check.id ?? 'unnamed_check');
    let applicable = true;
    const diagnostics: string[] = [];
    try {
      applicable = check.applies_when === undefined || evaluateConditionForTest(String(check.applies_when), { ...plan.contract.resolved_inputs, rendered_prompt: renderedPrompt });
    } catch (error) {
      applicable = true;
      diagnostics.push(`applies_when evaluation failed: ${(error as Error).message}`);
    }
    add({
      check_id: id,
      source: validatorsPath,
      applicable,
      executed: applicable,
      passed: applicable ? legacyPassed : null,
      blocking: String(check.severity ?? 'warning') === 'error',
      diagnostics: applicable && !legacyPassed ? [...diagnostics, ...((legacyValidation.errors as string[] | undefined) ?? [])] : diagnostics,
      evidence: { applies_when: check.applies_when ?? null, type: check.type ?? null },
    });
  }
  add({
    check_id: 'legacy_static_validation', source: validatorsPath, applicable: true, executed: true, passed: legacyPassed, blocking: true,
    diagnostics: [...((legacyValidation.errors as string[] | undefined) ?? []), ...((legacyValidation.warnings as string[] | undefined) ?? [])],
    evidence: { legacy_checks_reported: (legacyValidation.checks_run as string[] | undefined) ?? [] },
  });
  return records.sort((a, b) => a.check_id.localeCompare(b.check_id));
}

function sourceRecord(path: string): Dict {
  return { algorithm: 'sha256', path, sha256: sha256File(path) };
}

function governingSources(plan: GenerationPlan, config: PEaCConfig, legacyArtifact: Dict): Dict[] {
  const paths = new Set<string>([
    'peac.config.yaml',
    join(config.pipeline_path, 'intake.schema.json'),
    join(config.pipeline_path, 'artifact.schema.json'),
    join(config.pipeline_path, 'quality-gates.yaml'),
    join(config.pipeline_path, 'context-policy.yaml'),
    join(config.pipeline_path, 'model-profiles.yaml'),
    plan.contract.source_path,
    join(config.domains_path, plan.routing.domain, 'route.yaml'),
    join(config.domains_path, plan.routing.domain, 'rules.yaml'),
    join(config.domains_path, plan.routing.domain, 'validators.yaml'),
    String((legacyArtifact.provenance as Dict | undefined)?.template_used ?? ''),
    ...plan.policies.applied.map((record) => record.source_path),
    ...walkFiles('evals').filter((path) => /\.ya?ml$/.test(path)),
  ].filter((path) => path && existsSync(path)));
  return [...paths].sort().map(sourceRecord);
}

function authorizationState(plan: GenerationPlan, ledger: ValidationCheckRecord[], actualSha: string | null, expectedSha: string | null): { state: AuthorityState; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (plan.intake.normalized_inputs.fixture_inputs !== undefined || plan.publication.intended_authority_state === 'non_authoritative_fixture') return { state: 'non_authoritative_fixture', diagnostics: ['Fixture mode is never authoritative.'] };
  const blockingFailure = ledger.some((check) => check.applicable && check.blocking && (!check.executed || check.passed !== true));
  if (blockingFailure) return { state: 'rejected', diagnostics: ['At least one blocking validation check failed or was not executed.'] };
  if (!actualSha) return { state: 'rejected', diagnostics: ['Actual checkout commit could not be resolved.'] };
  if (expectedSha && actualSha.toLowerCase() !== expectedSha.toLowerCase()) return { state: 'rejected', diagnostics: [`Actual checkout SHA ${actualSha} does not match expected tested SHA ${expectedSha}.`] };
  if (plan.risk.classification === 'clarification_required') return { state: 'review_pending', diagnostics: ['General-domain maximum risk prevents automatic authorization.'] };
  if (plan.risk.review_required) return { state: 'review_pending', diagnostics: ['Runtime-derived risk requires an exact Artifact-bound review decision.'] };
  return { state: 'authorized', diagnostics };
}

function envelopeDigestInput(envelope: Omit<RuntimeArtifactEnvelope, 'envelope_sha256'>): unknown {
  return envelope;
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing Artifact: ${path}`);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, yaml.dump(value, { lineWidth: 120, noRefs: true }));
  renameSync(temporary, path);
}

function publicationDirectory(config: PEaCConfig, state: AuthorityState): string {
  if (state === 'authorized') return join(config.outputs_path, 'authorized');
  if (state === 'review_pending') return join(config.outputs_path, 'review-pending');
  if (state === 'non_authoritative_fixture') return join(config.outputs_path, 'fixtures');
  return join(config.outputs_path, 'rejected');
}

export function generateArtifact(envelope: ValidatedIntakeEnvelope, mode: ExecutionMode = 'batch', configOverride?: PEaCConfig): { artifact: RuntimeArtifactEnvelope; outputPath: string } {
  assertValidatedEnvelope(envelope);
  const config = configOverride ?? loadConfig();
  const plan = compileGenerationPlan(envelope, config);
  assertValidatedPlan(plan);
  const legacyArtifact = renderThroughStagedLegacy(plan, mode, config);
  const renderedPrompt = enforceConstraints(String(legacyArtifact.rendered_prompt ?? ''), plan);
  const ledger = structuredLedger(legacyArtifact, plan, config, renderedPrompt);
  const actualSha = actualCheckoutSha();
  const expectedSha = expectedTestedSha();
  const state = authorizationState(plan, ledger, actualSha, expectedSha);
  const artifactPayload: Dict = {
    ...legacyArtifact,
    generated_at: new Date().toISOString(),
    rendered_prompt: renderedPrompt,
    canonical_intake: {
      schema_id: envelope.schema_id,
      schema_version: envelope.schema_version,
      intake_digest: envelope.intake_digest,
      raw_request_digest: envelope.raw_request_digest,
      source_mode: envelope.source_mode,
      normalized_inputs: envelope.normalized_inputs,
    },
    generation_plan: plan,
    validation_ledger: { checks: ledger },
    runtime: {
      ...((legacyArtifact.runtime as Dict | undefined) ?? {}),
      git_commit_sha: actualSha,
      expected_tested_sha: expectedSha,
      provenance_source: 'git rev-parse HEAD',
    },
    assurance: {
      profile: plan.evaluation.profile,
      validation_kind: 'static_prompt_and_metadata_only',
      target_model_executed: false,
      behavioral_success_observed: false,
      semantic_correctness_claimed: false,
    },
    context_attribution: {
      state: plan.context.attribution_state,
      items: plan.context.items,
    },
    governing_sources: governingSources(plan, config, legacyArtifact),
    hashes: {
      ...((legacyArtifact.hashes as Dict | undefined) ?? {}),
      rendered_prompt_hash: sha256Text(renderedPrompt),
      normalized_inputs_hash: sha256Json(envelope.normalized_inputs),
      generation_plan_hash: sha256Json(plan),
      validation_ledger_hash: sha256Json(ledger),
    },
  };
  const artifactSha = sha256Json(artifactPayload);
  const partial: Omit<RuntimeArtifactEnvelope, 'envelope_sha256'> = {
    schema_id: 'peac.runtime-artifact-envelope',
    schema_version: 'runtime-artifact-envelope.v1',
    artifact_sha256: artifactSha,
    artifact: artifactPayload,
    authorization: {
      authority_state: state.state,
      downstream_use_allowed: state.state === 'authorized',
      review_required: plan.risk.review_required,
      review_receipt: null,
      diagnostics: state.diagnostics,
    },
  };
  const artifact: RuntimeArtifactEnvelope = { ...partial, envelope_sha256: sha256Json(envelopeDigestInput(partial)) };
  const id = String(legacyArtifact.prompt_id ?? `${plan.routing.domain}.default.v1`).replaceAll('.', '-');
  const outputPath = join(publicationDirectory(config, state.state), `${id}-${artifact.artifact_sha256.slice(0, 16)}.yaml`);
  writeAtomic(outputPath, artifact);
  return { artifact, outputPath };
}

function loadEnvelope(path: string): RuntimeArtifactEnvelope {
  const value = parseDataFile(path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Artifact envelope is not an object: ${path}`);
  return value as RuntimeArtifactEnvelope;
}

function artifactSchemaCheck(envelope: RuntimeArtifactEnvelope, config: PEaCConfig): string[] {
  const schemaPath = join(config.pipeline_path, 'runtime-artifact.schema.json');
  if (!existsSync(schemaPath)) return [`Missing Runtime Artifact schema: ${schemaPath}`];
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return validate(envelope) ? [] : formatAjvErrors(validate.errors);
}

function ledgerVerificationChecks(envelope: RuntimeArtifactEnvelope): ValidationCheckRecord[] {
  const artifact = envelope.artifact;
  const ledger = artifact.validation_ledger !== null && typeof artifact.validation_ledger === 'object' ? (artifact.validation_ledger as Dict).checks : [];
  if (!Array.isArray(ledger)) return [{ check_id: 'validation_ledger_shape', source: 'artifact', applicable: true, executed: true, passed: false, blocking: true, diagnostics: ['validation_ledger.checks must be an array'], evidence: {} }];
  return ledger.map((item) => item as ValidationCheckRecord);
}

export function verifyArtifact(path: string, configOverride?: PEaCConfig): VerificationResult {
  const config = configOverride ?? loadConfig();
  const diagnostics: string[] = [];
  let envelope: RuntimeArtifactEnvelope;
  try {
    envelope = loadEnvelope(path);
  } catch (error) {
    return { verification_status: 'rejected', artifact_sha256: null, authority_state: null, downstream_use_allowed: false, checks: [], diagnostics: [(error as Error).message] };
  }
  diagnostics.push(...artifactSchemaCheck(envelope, config));
  const calculatedArtifactSha = sha256Json(envelope.artifact);
  if (calculatedArtifactSha !== envelope.artifact_sha256) diagnostics.push('Artifact SHA-256 mismatch.');
  const { envelope_sha256: _ignored, ...withoutEnvelopeDigest } = envelope;
  const calculatedEnvelopeSha = sha256Json(envelopeDigestInput(withoutEnvelopeDigest));
  if (calculatedEnvelopeSha !== envelope.envelope_sha256) diagnostics.push('Envelope SHA-256 mismatch.');
  const artifact = envelope.artifact;
  const intake = artifact.canonical_intake as Dict | undefined;
  if (!intake || sha256Json(intake.normalized_inputs) !== intake.intake_digest) diagnostics.push('Canonical intake digest mismatch.');
  if (intake && intake.source_mode !== 'fixture_validation' && sha256Text(String((intake.normalized_inputs as Dict | undefined)?.request ?? '')) !== intake.raw_request_digest) diagnostics.push('Raw request digest mismatch.');
  const hashes = artifact.hashes as Dict | undefined;
  if (!hashes || hashes.rendered_prompt_hash !== sha256Text(String(artifact.rendered_prompt ?? ''))) diagnostics.push('Rendered Prompt hash mismatch.');
  if (!hashes || hashes.normalized_inputs_hash !== sha256Json((intake?.normalized_inputs as Dict | undefined) ?? {})) diagnostics.push('Normalized input hash mismatch.');
  const sources = Array.isArray(artifact.governing_sources) ? artifact.governing_sources as Dict[] : [];
  for (const source of sources) {
    const sourcePath = String(source.path ?? '');
    if (!sourcePath || !existsSync(sourcePath)) diagnostics.push(`Governing source unavailable: ${sourcePath || '<missing>'}`);
    else if (source.sha256 !== sha256File(sourcePath)) diagnostics.push(`Governing source hash mismatch: ${sourcePath}`);
  }
  const ledger = ledgerVerificationChecks(envelope);
  for (const check of ledger) {
    if (!check.applicable && (check.executed || check.passed !== null)) diagnostics.push(`Non-applicable check is falsely presented as executed: ${check.check_id}`);
    if (check.applicable && check.blocking && (!check.executed || check.passed !== true)) diagnostics.push(`Blocking check not satisfied: ${check.check_id}`);
  }
  const runtime = artifact.runtime as Dict | undefined;
  const checkoutSha = actualCheckoutSha();
  if (envelope.authorization.authority_state === 'authorized') {
    if (!checkoutSha) diagnostics.push('Actual checkout SHA unavailable for authorized Artifact.');
    if (!runtime?.git_commit_sha) diagnostics.push('Authorized Artifact has null git_commit_sha.');
    if (checkoutSha && runtime?.git_commit_sha !== checkoutSha) diagnostics.push('Artifact checkout SHA does not match current checkout.');
    if (!envelope.authorization.downstream_use_allowed) diagnostics.push('Authorized Artifact is not marked downstream-usable.');
  } else if (envelope.authorization.downstream_use_allowed) diagnostics.push('Non-authorized Artifact cannot be downstream-usable.');
  const receipt = envelope.authorization.review_receipt;
  if (envelope.authorization.review_required && envelope.authorization.authority_state === 'authorized') {
    if (!receipt) diagnostics.push('Required review receipt is missing.');
    else {
      if (receipt.artifact_sha256 !== envelope.artifact_sha256) diagnostics.push('Review receipt is bound to another Artifact.');
      if (receipt.decision !== 'approved') diagnostics.push('Review receipt decision does not authorize Artifact.');
    }
  }
  const context = artifact.context_attribution as Dict | undefined;
  if (context?.state === 'source_bound') {
    const items = Array.isArray(context.items) ? context.items as Dict[] : [];
    if (items.some((item) => item.attribution_state !== 'source_bound')) diagnostics.push('Context source_bound claim is not supported by all items.');
  }
  const status: VerificationStatus = diagnostics.length === 0 ? 'verified' : sources.some((source) => !existsSync(String(source.path ?? ''))) ? 'insufficient_evidence' : 'rejected';
  return {
    verification_status: status,
    artifact_sha256: envelope.artifact_sha256,
    authority_state: envelope.authorization.authority_state,
    downstream_use_allowed: status === 'verified' && envelope.authorization.downstream_use_allowed,
    checks: ledger,
    diagnostics,
  };
}

export function reviewArtifact(path: string, decision: 'approved' | 'rejected', limitations: string[] = [], configOverride?: PEaCConfig): { artifact: RuntimeArtifactEnvelope; outputPath: string } {
  const config = configOverride ?? loadConfig();
  const envelope = loadEnvelope(path);
  const verification = verifyArtifact(path, config);
  if (verification.verification_status === 'rejected') throw new Error(`Cannot review an invalid Artifact: ${verification.diagnostics.join('; ')}`);
  if (envelope.authorization.authority_state !== 'review_pending') throw new Error(`Artifact is not review_pending: ${envelope.authorization.authority_state}`);
  const receipt: ArtifactReviewReceipt = {
    receipt_type: 'artifact_review',
    receipt_version: 'artifact-review.v1',
    artifact_sha256: envelope.artifact_sha256,
    reviewer: 'owner',
    decision,
    reviewed_at: new Date().toISOString(),
    limitations,
  };
  const authorization = {
    authority_state: decision === 'approved' ? 'authorized' as const : 'rejected' as const,
    downstream_use_allowed: decision === 'approved',
    review_required: true,
    review_receipt: receipt,
    diagnostics: decision === 'approved' ? [] : ['Owner review rejected the Artifact.'],
  };
  const partial: Omit<RuntimeArtifactEnvelope, 'envelope_sha256'> = { ...envelope, authorization };
  const reviewed: RuntimeArtifactEnvelope = { ...partial, envelope_sha256: sha256Json(envelopeDigestInput(partial)) };
  const outputPath = join(publicationDirectory(config, authorization.authority_state), `${String(envelope.artifact.prompt_id ?? 'artifact').replaceAll('.', '-')}-${envelope.artifact_sha256.slice(0, 16)}.yaml`);
  writeAtomic(outputPath, reviewed);
  rmSync(path, { force: true });
  return { artifact: reviewed, outputPath };
}

function rawIntakeFromRequestArgument(value: string): unknown {
  if (existsSync(value)) return parseDataFile(value);
  return {
    request: value,
    desired_output: 'copy-ready prompt',
    target_environment: 'unspecified',
    strictness: 'precise',
  };
}

export function generateFromCliArgs(args: Record<string, string | boolean>): { artifact: RuntimeArtifactEnvelope; outputPath: string } {
  const mode = typeof args.mode === 'string' ? args.mode as ExecutionMode : 'batch';
  if (typeof args.case === 'string') return generateArtifact(createFixtureEnvelope(args.case), mode);
  if (typeof args.request !== 'string' || args.request.trim() === '') throw new Error('Provide --request <intake-file-or-text> or --case <fixture-file>.');
  const envelope = createValidatedIntakeEnvelope(rawIntakeFromRequestArgument(args.request), 'interactive_request');
  return generateArtifact(envelope, mode);
}
