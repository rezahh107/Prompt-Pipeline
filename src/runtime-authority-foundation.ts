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
export type RiskFactorState = 'present' | 'absent' | 'unknown';

export interface ValidatedIntakeEnvelope {
  schema_id: 'peac.validated-intake';
  schema_version: 'validated-intake.v1';
  intake_digest: string;
  raw_request_digest: string;
  normalized_inputs: Dict;
  source_mode: SourceMode;
  validation: { passed: true; schema_path: string; diagnostics: string[] };
  producer: { name: 'peac-canonical-intake'; version: string };
}

export interface RoutingDecision {
  domain: string;
  subtype: string | null;
  method: string;
  candidates: Array<{ domain: string; confidence: number }>;
  confidence: number;
  fallback_used: boolean;
  hint: string | null;
  hint_conflict: boolean;
  evidence: string[];
}

export interface RiskFactorAssessment {
  factor_id: string;
  state: RiskFactorState;
  source: 'runtime_derived' | 'caller_positive_hint' | 'domain_rule' | 'routing_signal' | 'configured_default';
  evidence: string[];
  caller_claim: boolean | null;
}

export interface AppliedRiskRule {
  rule_id: string;
  source_path: string;
  applicable: boolean;
  effect: 'low' | 'medium' | 'high' | null;
  evidence: string[];
  diagnostics: string[];
}

export interface RiskAssessment {
  classification: DerivedRisk;
  factors: RiskFactorAssessment[];
  applied_rules: AppliedRiskRule[];
  unknowns: string[];
  review_required: boolean;
  decision: string;
  signals: Array<{ id: string; value: string | boolean | number; source: 'derived' | 'caller_hint' }>;
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

export interface ArtifactReviewReceipt {
  receipt_type: 'artifact_review';
  receipt_version: 'artifact-review.v1';
  artifact_sha256: string;
  reviewer: 'owner';
  decision: 'approved' | 'rejected';
  reviewed_at: string;
  limitations: string[];
}

export interface CheckoutIdentity {
  actual_sha: string | null;
  expected_sha: string | null;
  source: 'git rev-parse HEAD';
}

export interface AuthorityDecision {
  authority_state: AuthorityState;
  downstream_use_allowed: boolean;
  review_required: boolean;
  diagnostics: string[];
}

export interface GenerationPlan {
  plan_id: 'peac.validated-generation-plan';
  plan_version: 'generation-plan.v2';
  intake: { schema_id: string; digest: string; normalized_inputs: Dict };
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
  policies: { applicable: AppliedConstraint[]; applied: AppliedConstraint[] };
  rules: { applicable: AppliedConstraint[]; applied: AppliedConstraint[] };
  context: { items: Dict[]; attribution_state: 'manual_attributed' | 'source_bound' | 'unknown' | 'untrusted' };
  evaluation: {
    profile: string;
    suites: string[];
    assurance: 'static_production_profile' | 'static_production_profile_validated' | 'static_profile';
  };
  required_checks: Array<{ check_id: string }>;
  publication: { intended_authority_state: AuthorityState };
}

export interface RuntimeAssessment {
  routing: RoutingDecision;
  risk: RiskAssessment;
  contract: GenerationPlan['contract'];
  policies: GenerationPlan['policies'];
  rules: GenerationPlan['rules'];
  context: GenerationPlan['context'];
  generationPlan: GenerationPlan;
  validationLedger: ValidationCheckRecord[];
  authorityDecision: AuthorityDecision;
}

export interface RuntimeDerivationInput {
  validatedIntake: ValidatedIntakeEnvelope;
  config: PEaCConfig;
  renderedPrompt?: string;
  legacyArtifact?: Dict;
  checkoutIdentity?: CheckoutIdentity;
  reviewReceipt?: ArtifactReviewReceipt | null;
  artifactSha256?: string | null;
  integrity?: {
    artifact_valid: boolean;
    envelope_valid: boolean;
    governing_sources_valid: boolean;
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

export interface VerificationResult {
  verification_status: VerificationStatus;
  integrity_valid: boolean;
  semantic_derivation_valid: boolean;
  authority_consistent: boolean;
  artifact_sha256: string | null;
  authority_state: AuthorityState | null;
  downstream_use_allowed: boolean;
  checks: ValidationCheckRecord[];
  diagnostics: string[];
}

export interface ContractField {
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

export interface DomainContract {
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

export interface DomainValidator {
  id?: string;
  applies_when?: string;
  severity?: string;
  type?: string;
  required_policy_id?: string;
  message?: string;
  forbidden_patterns?: string[];
  check?: string;
}

export interface CaseFile {
  case_id?: string;
  description?: string;
  domain: string;
  subtype?: string;
  version?: string;
  inputs: Dict;
}

export interface GoverningSource {
  algorithm: 'sha256';
  path: string;
  sha256: string;
}

const validatedEnvelopes = new WeakSet<object>();
export const validatedPlans = new WeakSet<object>();
export const RISK_BOOLEAN_FIELDS = [
  'sensitive_or_high_risk',
  'uses_external_tools',
  'legal_medical_financial',
  'requires_current_information',
  'exact_factual_claims',
  'external_files',
  'potential_downstream_execution',
] as const;
export const CORE_CHECK_IDS = [
  'artifact_integrity',
  'canonical_intake_digest',
  'checkout_identity',
  'domain_contract',
  'envelope_integrity',
  'governing_sources_integrity',
  'policy_rule_carriers',
  'review_eligibility',
  'runtime_risk_derivation',
  'runtime_routing_derivation',
] as const;
export const HIGH_STAKES_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: 'medical_request', regex: /\b(medical|medicine|diagnos(?:is|e)|treatment|prescription|symptom|health advice|metformin|milligrams?|dosage|dose|insulin|antibiotic)\b|پزشک|پزشکی|تشخیص|درمان|دارو|نسخه|دوز/i },
  { id: 'legal_request', regex: /\b(legal|lawyer|lawsuit|court|statute|liability|indemnity|evict(?:ion)?|tenant rights?|contract advice)\b|حقوقی|وکیل|دادگاه|شکایت|اخراج مستاجر|مسئولیت حقوقی/i },
  { id: 'financial_request', regex: /\b(financial|investment|tax|securities|portfolio|leveraged fund|asset allocation|retirement savings|loan advice)\b|مشاوره مالی|سرمایه.?گذاری|مالیات|بورس|پرتفوی/i },
  { id: 'irreversible_operation', regex: /\b(permanently erase|irreversibly delete|drop production|destroy records|force.?push|wipe database|deploy to production|merge and release)\b|حذف دائمی|پاک کردن تولید|برگشت.?ناپذیر/i },
  { id: 'safety_sensitive_request', regex: /\b(safety-critical|hazardous|dangerous operation|explosive|high voltage)\b|ایمنی.?حیاتی|خطرناک|مواد منفجره|ولتاژ بالا/i },
];
export const BENIGN_PATTERNS = [
  /\b(friendly greeting|hello message|short greeting|birthday wish|brainstorm names|write a poem|grammar correction|rewrite this sentence|summarize provided text|title ideas)\b/i,
  /سلام دوستانه|پیام تبریک|اصلاح نگارش|بازنویسی جمله|ایده عنوان|شعر کوتاه/i,
];
export const DESTRUCTIVE_ACTION_PATTERN = /\b(delete|erase|destroy|drop|force.?push|merge|deploy|publish|release|execute|run command|write file|modify repository)\b/i;
export const TOOL_ACTION_PATTERN = /\b(api|tool|browser|search web|execute|run|shell|terminal|connector|plugin)\b/i;
export const CURRENT_INFO_PATTERN = /\b(latest|today|current|right now|live price|current law|current version|this week)\b|امروز|آخرین|فعلی|قیمت لحظه.?ای|قانون جاری/i;
export const EXACT_CLAIM_PATTERN = /\b(exact quote|verbatim|precise citation|exact figure|exact date|official value)\b|نقل قول دقیق|عدد دقیق|تاریخ دقیق|مقدار رسمی/i;

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

export function sha256File(path: string): string {
  return sha256Text(readFileSync(path, 'utf8'));
}

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
}

export function parseDataFile(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  if (extname(path).toLowerCase() === '.json') return JSON.parse(text) as unknown;
  return yaml.load(text) as unknown;
}

export function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(path));
    else result.push(path);
  }
  return result;
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
  for (const key of ['constraints', 'available_sources', 'eval_suite', 'requested_actions']) {
    if (Array.isArray(value[key])) copy[key] = [...value[key] as unknown[]].map(String).sort();
  }
  for (const key of ['success_criteria', 'failure_modes']) {
    if (Array.isArray(value[key])) copy[key] = [...value[key] as unknown[]].map(String);
  }
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

export function createValidatedIntakeEnvelope(
  raw: unknown,
  sourceMode: Exclude<SourceMode, 'fixture_validation'>,
  configOverride?: PEaCConfig,
): ValidatedIntakeEnvelope {
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
    validation: { passed: true, schema_path: join(config.pipeline_path, 'intake.schema.json'), diagnostics: [] },
    producer: { name: 'peac-canonical-intake', version: config.version ?? 'dev' },
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
    requested_actions: [],
    available_sources: [],
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
    producer: { name: 'peac-canonical-intake', version: config.version ?? 'dev' },
  };
  validatedEnvelopes.add(envelope);
  return envelope;
}

export function rehydrateEnvelope(canonicalIntake: Dict, config: PEaCConfig): ValidatedIntakeEnvelope {
  const sourceMode = canonicalIntake.source_mode as SourceMode;
  const normalized = canonicalIntake.normalized_inputs;
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) throw new Error('Canonical intake normalized_inputs is invalid.');
  if (sourceMode !== 'fixture_validation') {
    const validated = normalizeIntake(schemaValidateIntake(normalized, config));
    if (canonicalJson(validated) !== canonicalJson(normalized)) throw new Error('Canonical intake normalization mismatch.');
  }
  const envelope: ValidatedIntakeEnvelope = {
    schema_id: 'peac.validated-intake',
    schema_version: 'validated-intake.v1',
    intake_digest: String(canonicalIntake.intake_digest ?? ''),
    raw_request_digest: String(canonicalIntake.raw_request_digest ?? ''),
    normalized_inputs: normalized as Dict,
    source_mode: sourceMode,
    validation: { passed: true, schema_path: join(config.pipeline_path, 'intake.schema.json'), diagnostics: [] },
    producer: { name: 'peac-canonical-intake', version: config.version ?? 'dev' },
  };
  validatedEnvelopes.add(envelope);
  assertValidatedEnvelope(envelope);
  return envelope;
}

export function assertValidatedEnvelope(envelope: ValidatedIntakeEnvelope): void {
  if (!validatedEnvelopes.has(envelope)) throw new Error('ValidatedIntakeEnvelope must be produced by the canonical intake processor in this process.');
  if (sha256Json(envelope.normalized_inputs) !== envelope.intake_digest) throw new Error('ValidatedIntakeEnvelope intake digest mismatch.');
  if (envelope.source_mode !== 'fixture_validation') {
    const request = String(envelope.normalized_inputs.request ?? '');
    if (sha256Text(request) !== envelope.raw_request_digest) throw new Error('ValidatedIntakeEnvelope raw request digest mismatch.');
  }
}
