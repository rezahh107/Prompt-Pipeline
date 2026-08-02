import type { Dict } from './peac.js';
import type { RuntimePlanAssessment, ValidatedIntakeEnvelope } from './runtime-authority-foundation.js';

export interface DerivedDelegatedTargetRequest {
  targetRequest: string;
  derivationMethod: 'explicit_target_request' | 'registered_wrapper';
  explicit: boolean;
  targetInputs: Dict;
}

export interface DelegatedRenderProjection {
  domain: string;
  subtype: string;
  resolvedInputs: Dict;
}

const TARGET_RESERVED_AUTHORITY_FIELDS = new Set([
  'authority',
  'authority_state',
  'contract',
  'contract_id',
  'contract_identity',
  'domain',
  'governing_sources',
  'human_review',
  'publication',
  'requires_human_review',
  'review_receipt',
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

const REGISTERED_WRAPPERS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'en_create_prompt_for', pattern: /^\s*create\s+(?:a\s+)?prompt\s+for\s+(.+?)\s*[.!?]?\s*$/i },
  { id: 'en_create_prompt_to', pattern: /^\s*create\s+(?:a\s+)?prompt\s+to\s+(.+?)\s*[.!?]?\s*$/i },
  { id: 'en_generate_prompt_for', pattern: /^\s*generate\s+(?:a\s+)?prompt\s+for\s+(.+?)\s*[.!?]?\s*$/i },
  { id: 'en_write_reusable_prompt_for', pattern: /^\s*write\s+(?:a\s+)?reusable\s+prompt\s+for\s+(.+?)\s*[.!?]?\s*$/i },
  { id: 'fa_for_task_make_prompt', pattern: /^\s*برای\s+(.+?)\s+(?:یک\s+)?پرامپت\s+(?:بساز|بنویس|طراحی\s+کن)\s*[.!؟]?\s*$/i },
  { id: 'fa_write_prompt_for_task', pattern: /^\s*(?:یک\s+)?پرامپت\s+برای\s+(.+?)\s+(?:بساز|بنویس|طراحی\s+کن)\s*[.!؟]?\s*$/i },
];

const RECURSIVE_WRAPPER_PATTERN = /\b(?:create|generate|write|build|draft|design)\s+(?:a\s+)?(?:reusable\s+)?prompt\b|(?:ساخت|تولید|نوشتن|طراحی)\s+پرامپت|پرامپت\s+(?:بساز|بنویس|طراحی\s+کن)/i;
const CONFLICTING_META_OPERATION_PATTERN = /\b(?:and\s+then|then\s+also|also\s+create\s+(?:a\s+)?prompt|instead\s+execute)\b|(?:و\s+سپس|همچنین\s+یک\s+پرامپت|به\s+جای\s+آن\s+اجرا)/i;

function normalize(value: unknown): string {
  return String(value ?? '').replace(/[\s\r\n\t]+/g, ' ').trim().replace(/[.!?؟]+$/u, '').trim();
}

function asTargetInputs(value: unknown): Dict {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('target_inputs must be an object.');
  const inputs = structuredClone(value as Dict);
  for (const key of Object.keys(inputs)) {
    if (TARGET_RESERVED_AUTHORITY_FIELDS.has(key)) throw new Error(`target_inputs cannot override reserved authority field: ${key}`);
  }
  return inputs;
}

function extractedWrapperTargets(request: string): Array<{ id: string; target: string }> {
  const matches: Array<{ id: string; target: string }> = [];
  for (const wrapper of REGISTERED_WRAPPERS) {
    const match = request.match(wrapper.pattern);
    if (!match) continue;
    matches.push({ id: wrapper.id, target: normalize(match[1]) });
  }
  return matches;
}

export function deriveDelegatedTargetRequest(envelope: ValidatedIntakeEnvelope): DerivedDelegatedTargetRequest | null {
  const intake = envelope.normalized_inputs;
  if (envelope.source_mode === 'fixture_validation' && intake.target_request === undefined) return null;
  const request = normalize(intake.request);
  const explicitTarget = intake.target_request === undefined ? '' : normalize(intake.target_request);
  const targetInputs = asTargetInputs(intake.target_inputs);
  const extracted = extractedWrapperTargets(request);
  const uniqueExtractedTargets = [...new Set(extracted.map((item) => item.target))];

  if (extracted.length > 1 && uniqueExtractedTargets.length > 1) {
    throw new Error(`Conflicting delegated wrapper forms resolved different target tasks: ${uniqueExtractedTargets.join(' | ')}`);
  }
  const extractedTarget = uniqueExtractedTargets[0] ?? '';
  if (explicitTarget && extractedTarget && explicitTarget.toLocaleLowerCase() !== extractedTarget.toLocaleLowerCase()) {
    throw new Error('Explicit target_request conflicts with the target task extracted from the registered wrapper.');
  }
  const targetRequest = explicitTarget || extractedTarget;
  if (!targetRequest) {
    if (Object.keys(targetInputs).length > 0) throw new Error('target_inputs requires a non-empty target_request or a registered delegated wrapper.');
    return null;
  }
  if (CONFLICTING_META_OPERATION_PATTERN.test(request)) {
    throw new Error('Mixed or conflicting delegated operations require clarification.');
  }
  if (RECURSIVE_WRAPPER_PATTERN.test(targetRequest)) {
    throw new Error('Delegated target task cannot recursively request another prompt-generation route.');
  }
  return {
    targetRequest,
    derivationMethod: explicitTarget ? 'explicit_target_request' : 'registered_wrapper',
    explicit: Boolean(explicitTarget),
    targetInputs,
  };
}

export function delegatedTargetFromPlan(plan: RuntimePlanAssessment): Dict | null {
  const generationPlan = plan.generationPlan as unknown as Dict;
  if (generationPlan.plan_version !== 'generation-plan.v3') return null;
  const target = generationPlan.delegated_target;
  return target !== null && typeof target === 'object' && !Array.isArray(target) ? target as Dict : null;
}

export function delegatedRenderProjection(plan: RuntimePlanAssessment): DelegatedRenderProjection | null {
  const target = delegatedTargetFromPlan(plan);
  if (!target) return null;
  const routing = target.routing as Dict | undefined;
  const contract = target.contract as Dict | undefined;
  const domain = String(routing?.domain ?? '');
  const subtype = String(target.subtype ?? routing?.subtype ?? '');
  const resolvedInputs = contract?.resolved_inputs;
  if (!domain || !subtype || !resolvedInputs || typeof resolvedInputs !== 'object' || Array.isArray(resolvedInputs)) {
    throw new Error('DelegatedTargetPlan render projection is malformed.');
  }
  return { domain, subtype, resolvedInputs: resolvedInputs as Dict };
}

export function delegationProvenance(plan: RuntimePlanAssessment): Dict | null {
  const target = delegatedTargetFromPlan(plan);
  if (!target) return null;
  return {
    outer: {
      domain: plan.routing.domain,
      subtype: plan.routing.subtype,
      contract: {
        id: plan.contract.id,
        version: plan.contract.version,
        source_path: plan.contract.source_path,
        source_sha256: plan.contract.source_sha256,
      },
    },
    target: structuredClone(target),
  };
}
