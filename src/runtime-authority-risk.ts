import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateConditionForTest, loadConfig, readYamlFile, routeRequestForTest, type Dict, type PEaCConfig } from './peac.js';
import {
  BENIGN_PATTERNS,
  CURRENT_INFO_PATTERN,
  DESTRUCTIVE_ACTION_PATTERN,
  EXACT_CLAIM_PATTERN,
  HIGH_STAKES_PATTERNS,
  RISK_BOOLEAN_FIELDS,
  TOOL_ACTION_PATTERN,
  type AppliedRiskRule,
  type DerivedRisk,
  type GenerationPlan,
  type RiskAssessment,
  type RiskFactorAssessment,
  type RiskFactorState,
  type RoutingDecision,
  type ValidatedIntakeEnvelope,
  assertValidatedEnvelope,
} from './runtime-authority-foundation.js';

export function buildRoutingDecision(envelope: ValidatedIntakeEnvelope, config: PEaCConfig): RoutingDecision {
  const intake = envelope.normalized_inputs;
  const request = String(intake.request ?? '');
  const hint = typeof intake.domain_hint === 'string' ? intake.domain_hint : null;
  const routed = routeRequestForTest(request, config);
  const strongDerived = routed.domain !== 'general' && routed.confidence >= 0.8;
  const hintConflict = Boolean(hint && strongDerived && hint !== routed.domain);
  let domain = routed.domain;
  let method = routed.method;
  let confidence = routed.confidence;
  const evidence: string[] = [`router:${routed.domain}:${routed.confidence.toFixed(3)}`];
  if (hint) evidence.push(`caller_hint:${hint}`);
  if (hintConflict) {
    evidence.push(`hint_conflict:${hint}->${routed.domain}`);
    method = `${routed.method}+conflicting_hint_ignored`;
  } else if (hint && routed.domain === 'general' && hint !== 'general') {
    domain = hint;
    method = 'domain_hint_after_router_fallback';
    confidence = Math.min(0.79, Math.max(0.5, routed.confidence));
    evidence.push('router_fallback_hint_used_as_evidence');
  } else if (hint && hint === routed.domain) {
    method = `${routed.method}+corroborated_hint`;
    evidence.push('hint_agrees_with_router');
  }
  return {
    domain,
    subtype: typeof intake.fixture_subtype === 'string' ? intake.fixture_subtype : domain === routed.domain ? routed.subtype : null,
    method,
    candidates: routed.evidence?.competing_candidates?.map((candidate) => ({ domain: candidate.domain, confidence: candidate.confidence })) ?? [],
    confidence,
    fallback_used: routed.domain === 'general' || routed.method.includes('fallback'),
    hint,
    hint_conflict: hintConflict,
    evidence,
  };
}

function isClearlyBenign(intake: Dict, request: string): boolean {
  const requestedActions = Array.isArray(intake.requested_actions) ? intake.requested_actions.map(String).join(' ') : '';
  const interaction = `${String(intake.model_interaction_mode ?? '')} ${String(intake.consumer_path ?? '')}`;
  return BENIGN_PATTERNS.some((pattern) => pattern.test(request))
    && !HIGH_STAKES_PATTERNS.some((pattern) => pattern.regex.test(request))
    && !DESTRUCTIVE_ACTION_PATTERN.test(requestedActions)
    && !TOOL_ACTION_PATTERN.test(`${requestedActions} ${interaction}`)
    && !CURRENT_INFO_PATTERN.test(request)
    && !EXACT_CLAIM_PATTERN.test(request)
    && (!Array.isArray(intake.available_sources) || intake.available_sources.length === 0);
}

function factor(
  factorId: string,
  state: RiskFactorState,
  source: RiskFactorAssessment['source'],
  evidence: string[],
  callerClaim: boolean | null,
): RiskFactorAssessment {
  return { factor_id: factorId, state, source, evidence, caller_claim: callerClaim };
}

function riskRank(value: 'low' | 'medium' | 'high'): number {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}

function deriveRiskRules(config: PEaCConfig, routing: RoutingDecision, inputs: Dict): AppliedRiskRule[] {
  const path = join(config.domains_path, routing.domain, 'route.yaml');
  if (!existsSync(path)) return [];
  const route = readYamlFile<{ risk_overrides?: Array<{ condition?: string; risk?: 'low' | 'medium' | 'high'; note?: string }> }>(path) ?? {};
  return (route.risk_overrides ?? []).map((rule, index) => {
    const diagnostics: string[] = [];
    let applicable = false;
    try {
      applicable = evaluateConditionForTest(String(rule.condition ?? ''), inputs);
    } catch (error) {
      diagnostics.push(`condition evaluation failed: ${(error as Error).message}`);
    }
    return {
      rule_id: `domain-risk:${routing.domain}:${index + 1}`,
      source_path: path,
      applicable,
      effect: applicable && rule.risk ? rule.risk : null,
      evidence: [String(rule.condition ?? ''), String(rule.note ?? '')].filter(Boolean),
      diagnostics,
    };
  });
}

export function deriveRisk(
  envelope: ValidatedIntakeEnvelope,
  routing: RoutingDecision,
  configOverride?: PEaCConfig,
  resolvedInputs?: Dict,
): RiskAssessment {
  assertValidatedEnvelope(envelope);
  const config = configOverride ?? loadConfig();
  const intake = envelope.normalized_inputs;
  const request = String(intake.request ?? '');
  const benign = isClearlyBenign(intake, request);
  const factors = new Map<string, RiskFactorAssessment>();
  for (const field of RISK_BOOLEAN_FIELDS) {
    const claim = typeof intake[field] === 'boolean' ? intake[field] as boolean : null;
    if (claim === true) factors.set(field, factor(field, 'present', 'caller_positive_hint', [`caller:${field}=true`], true));
    else if (benign) factors.set(field, factor(field, 'absent', 'runtime_derived', ['benign_request_profile', claim === false ? `caller_negative_claim:${field}=false` : 'caller_field_missing'], claim));
    else factors.set(field, factor(field, 'unknown', 'configured_default', [claim === false ? `caller_negative_claim_not_authoritative:${field}=false` : `missing:${field}`], claim));
  }
  for (const pattern of HIGH_STAKES_PATTERNS) {
    if (!pattern.regex.test(request)) continue;
    factors.set('sensitive_or_high_risk', factor('sensitive_or_high_risk', 'present', 'runtime_derived', [`request_pattern:${pattern.id}`], typeof intake.sensitive_or_high_risk === 'boolean' ? intake.sensitive_or_high_risk as boolean : null));
    if (pattern.id === 'medical_request' || pattern.id === 'legal_request' || pattern.id === 'financial_request') {
      factors.set('legal_medical_financial', factor('legal_medical_financial', 'present', 'runtime_derived', [`request_pattern:${pattern.id}`], typeof intake.legal_medical_financial === 'boolean' ? intake.legal_medical_financial as boolean : null));
    }
    if (pattern.id === 'irreversible_operation') factors.set('potential_downstream_execution', factor('potential_downstream_execution', 'present', 'runtime_derived', [`request_pattern:${pattern.id}`], typeof intake.potential_downstream_execution === 'boolean' ? intake.potential_downstream_execution as boolean : null));
  }
  const requestedActions = Array.isArray(intake.requested_actions) ? intake.requested_actions.map(String) : [];
  const actionText = requestedActions.join(' ');
  const interactionText = `${String(intake.model_interaction_mode ?? '')} ${String(intake.consumer_path ?? '')}`;
  if (DESTRUCTIVE_ACTION_PATTERN.test(actionText) || /agent|autonomous|tool.?calling|execution/i.test(interactionText)) {
    factors.set('potential_downstream_execution', factor('potential_downstream_execution', 'present', 'routing_signal', [actionText || interactionText], typeof intake.potential_downstream_execution === 'boolean' ? intake.potential_downstream_execution as boolean : null));
  }
  if (TOOL_ACTION_PATTERN.test(`${actionText} ${interactionText}`)) {
    factors.set('uses_external_tools', factor('uses_external_tools', 'present', 'routing_signal', [actionText || interactionText], typeof intake.uses_external_tools === 'boolean' ? intake.uses_external_tools as boolean : null));
  }
  if (Array.isArray(intake.available_sources) && intake.available_sources.length > 0) {
    factors.set('external_files', factor('external_files', 'present', 'runtime_derived', [`available_sources:${intake.available_sources.length}`], typeof intake.external_files === 'boolean' ? intake.external_files as boolean : null));
  }
  if (CURRENT_INFO_PATTERN.test(request)) factors.set('requires_current_information', factor('requires_current_information', 'present', 'runtime_derived', ['request_requires_current_information'], typeof intake.requires_current_information === 'boolean' ? intake.requires_current_information as boolean : null));
  if (EXACT_CLAIM_PATTERN.test(`${request} ${String(intake.desired_output ?? '')}`)) factors.set('exact_factual_claims', factor('exact_factual_claims', 'present', 'runtime_derived', ['request_requires_exact_claims'], typeof intake.exact_factual_claims === 'boolean' ? intake.exact_factual_claims as boolean : null));

  const domainInputs = { ...(resolvedInputs ?? seedDomainInputs(envelope, routing.domain)), domain: routing.domain };
  const appliedRules = deriveRiskRules(config, routing, domainInputs);
  let rank = 1;
  for (const item of factors.values()) {
    if (item.state !== 'present') continue;
    if (['sensitive_or_high_risk', 'legal_medical_financial', 'uses_external_tools', 'potential_downstream_execution'].includes(item.factor_id)) rank = 3;
    else rank = Math.max(rank, 2);
  }
  for (const rule of appliedRules) {
    if (rule.diagnostics.length > 0) continue;
    if (rule.applicable && rule.effect) rank = Math.max(rank, riskRank(rule.effect));
  }
  const unknowns = [...factors.values()].filter((item) => item.state === 'unknown').map((item) => item.factor_id).sort();
  const ruleError = appliedRules.some((rule) => rule.diagnostics.length > 0);
  let classification: DerivedRisk = rank === 3 ? 'high' : rank === 2 ? 'medium' : 'low';
  if ((unknowns.length > 0 || ruleError) && rank < 3) classification = 'unknown';
  if (routing.hint_conflict) classification = 'clarification_required';
  if (routing.domain === 'general' && classification !== 'low') classification = 'clarification_required';
  const consequentialPresent = [...factors.values()].some((item) => item.state === 'present' && ['uses_external_tools', 'potential_downstream_execution', 'requires_current_information', 'external_files'].includes(item.factor_id));
  const reviewRequired = classification === 'high'
    || classification === 'unknown'
    || classification === 'clarification_required'
    || consequentialPresent
    || intake.human_review_required === true;
  const signals: RiskAssessment['signals'] = [...factors.values()].map((item) => ({
    id: item.factor_id,
    value: item.state,
    source: item.source === 'caller_positive_hint' ? 'caller_hint' : 'derived',
  }));
  return {
    classification,
    factors: [...factors.values()].sort((a, b) => a.factor_id.localeCompare(b.factor_id)),
    applied_rules: appliedRules,
    unknowns,
    review_required: reviewRequired,
    decision: routing.hint_conflict
      ? 'domain hint conflicts with strong Runtime routing evidence'
      : classification === 'clarification_required'
        ? 'selected route cannot support automatic authorization for the derived risk'
        : classification === 'unknown'
          ? 'consequential factors remain unresolved'
          : `canonical Runtime assessment resolved ${classification} risk`,
    signals,
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
    legal_medical_financial: intake.legal_medical_financial,
    exact_factual_claims: intake.exact_factual_claims,
    external_files: intake.external_files,
    requested_actions: intake.requested_actions,
    consumer_path: intake.consumer_path,
    model_interaction_mode: intake.model_interaction_mode,
    potential_downstream_execution: intake.potential_downstream_execution,
  }).filter(([, value]) => value !== undefined));
}

export function seedDomainInputs(envelope: ValidatedIntakeEnvelope, domain: string): Dict {
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
