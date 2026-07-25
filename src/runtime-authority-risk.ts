import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateConditionForTest, loadConfig, readYamlFile, routeRequestForTest, type Dict, type PEaCConfig } from './peac.js';
import {
  CURRENT_INFO_PATTERN,
  DESTRUCTIVE_ACTION_PATTERN,
  EXACT_CLAIM_PATTERN,
  HIGH_STAKES_PATTERNS,
  RISK_BOOLEAN_FIELDS,
  TOOL_ACTION_PATTERN,
  type AppliedRiskRule,
  type BenignResolution,
  type CanonicalRiskSurface,
  type DerivedRisk,
  type RiskAssessment,
  type RiskFactorAssessment,
  type RiskFactorState,
  type RoutingDecision,
  type ValidatedIntakeEnvelope,
  assertValidatedEnvelope,
} from './runtime-authority-foundation.js';
import { matchBenignOperationRequest } from './runtime-authority-benign-operations.js';

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/[\s\r\n\t]+/g, ' ').trim();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(normalizeText).filter(Boolean).sort() : [];
}

export function buildCanonicalRiskSurface(envelope: ValidatedIntakeEnvelope): CanonicalRiskSurface {
  assertValidatedEnvelope(envelope);
  const intake = envelope.normalized_inputs;
  return {
    request: normalizeText(intake.request),
    desiredOutput: normalizeText(intake.desired_output),
    constraints: stringArray(intake.constraints),
    requestedActions: stringArray(intake.requested_actions),
    consumerPath: normalizeText(intake.consumer_path) || null,
    modelInteractionMode: normalizeText(intake.model_interaction_mode) || null,
    availableSources: stringArray(intake.available_sources),
    targetEnvironment: normalizeText(intake.target_environment) || null,
  };
}

function surfaceText(surface: CanonicalRiskSurface): string {
  return [
    surface.request,
    surface.desiredOutput,
    ...surface.constraints,
    ...surface.requestedActions,
    surface.consumerPath ?? '',
    surface.modelInteractionMode ?? '',
    ...surface.availableSources,
    surface.targetEnvironment ?? '',
  ].filter(Boolean).join(' | ');
}

const MIXED_INTENT_PATTERN = /\b(and then|then instruct|but include|also produce|also provide|include instructions?|preserve instructions?|convert .* into|and include|and provide|and create)\b|\b(?:then|also|but)\b|\s[;&]\s|\s(?:و سپس|سپس|همچنین|اما)\s/i;
const CONSEQUENTIAL_OPERATION_PATTERN = /\b(machine guard|safety interlock|production backups?|energize exposed equipment|executable terminal commands?|autonomous execution|tool.?calling agent|modif(?:y|ies) the repository|operator|technician|procedure|commands?)\b/i;
const BENIGN_DESIRED_OUTPUT_PATTERN = /^(?:a\s+)?(?:short\s+)?(?:reusable\s+)?(?:prompt|message|greeting|birthday wish|congratulation message|corrected sentence|rewritten text|summary|list of names|poem|text)$/i;
const BENIGN_CONSTRAINT_PATTERN = /^(?:short|concise|friendly|grammar only|preserve meaning|no explanation|plain text|one sentence|keep the meaning)$/i;

function detectConsequentialSignals(surface: CanonicalRiskSurface): string[] {
  const text = surfaceText(surface);
  const signals: string[] = [];
  for (const item of HIGH_STAKES_PATTERNS) if (item.regex.test(text)) signals.push(item.id);
  if (DESTRUCTIVE_ACTION_PATTERN.test(text)) signals.push('destructive_operation');
  if (TOOL_ACTION_PATTERN.test(text)) signals.push('tool_or_execution_operation');
  if (CURRENT_INFO_PATTERN.test(text)) signals.push('current_information');
  if (EXACT_CLAIM_PATTERN.test(text)) signals.push('exact_claim');
  if (CONSEQUENTIAL_OPERATION_PATTERN.test(text)) signals.push('consequential_secondary_operation');
  return [...new Set(signals)].sort();
}

export function resolveBenignOperation(surface: CanonicalRiskSurface): BenignResolution {
  const match = matchBenignOperationRequest(surface.request);
  const operation = match?.operation ?? null;
  const secondaryActions: string[] = [];
  const unresolvedClauses: string[] = [];
  const consequentialSignals = detectConsequentialSignals(surface);
  const evidence: string[] = [];

  if (MIXED_INTENT_PATTERN.test(surface.request)) secondaryActions.push('mixed_request_clause');
  if (surface.requestedActions.length > 0) secondaryActions.push(...surface.requestedActions.map((item) => `requested_action:${item}`));
  if (surface.consumerPath) secondaryActions.push(`consumer_path:${surface.consumerPath}`);
  if (surface.modelInteractionMode) secondaryActions.push(`model_interaction_mode:${surface.modelInteractionMode}`);
  if (surface.availableSources.length > 0) secondaryActions.push(...surface.availableSources.map((item) => `available_source:${item}`));

  if (!operation) unresolvedClauses.push('request_not_fully_recognized_as_one_benign_operation');
  if (surface.desiredOutput && !BENIGN_DESIRED_OUTPUT_PATTERN.test(surface.desiredOutput)) unresolvedClauses.push(`desired_output:${surface.desiredOutput}`);
  for (const constraint of surface.constraints) if (!BENIGN_CONSTRAINT_PATTERN.test(constraint)) unresolvedClauses.push(`constraint:${constraint}`);
  if (secondaryActions.length > 0) unresolvedClauses.push('secondary_authority_relevant_fields_present');
  if (consequentialSignals.length > 0) unresolvedClauses.push('consequential_signal_present');

  if (operation) evidence.push(`recognized_operation:${operation}`);
  if (match) {
    evidence.push(`recognized_operation_pattern:${match.patternId}`);
    evidence.push(`recognized_payload_kind:${match.payloadKind}`);
  }
  if (operation && secondaryActions.length === 0 && unresolvedClauses.length === 0 && consequentialSignals.length === 0) evidence.push('complete_intent_covered');

  return {
    operation,
    completeIntentCovered: Boolean(operation) && secondaryActions.length === 0 && unresolvedClauses.length === 0 && consequentialSignals.length === 0,
    secondaryActions: [...new Set(secondaryActions)].sort(),
    unresolvedClauses: [...new Set(unresolvedClauses)].sort(),
    consequentialSignals,
    evidence,
  };
}

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
    evidence.push('router_fallback_hint_used_as_evidence_only');
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
  const surface = buildCanonicalRiskSurface(envelope);
  const benignResolution = resolveBenignOperation(surface);
  const benignComplete = benignResolution.operation !== null
    && benignResolution.completeIntentCovered
    && benignResolution.secondaryActions.length === 0
    && benignResolution.unresolvedClauses.length === 0
    && benignResolution.consequentialSignals.length === 0;
  const fullText = surfaceText(surface);
  const factors = new Map<string, RiskFactorAssessment>();

  for (const field of RISK_BOOLEAN_FIELDS) {
    const claim = typeof intake[field] === 'boolean' ? intake[field] as boolean : null;
    if (claim === true) factors.set(field, factor(field, 'present', 'caller_positive_hint', [`caller:${field}=true`], true));
    else if (benignComplete) factors.set(field, factor(field, 'absent', 'runtime_derived', [`closed_world_benign:${benignResolution.operation}`, claim === false ? `caller_negative_claim:${field}=false` : 'caller_field_missing'], claim));
    else factors.set(field, factor(field, 'unknown', 'configured_default', [claim === false ? `caller_negative_claim_not_authoritative:${field}=false` : `missing:${field}`], claim));
  }

  for (const pattern of HIGH_STAKES_PATTERNS) {
    if (!pattern.regex.test(fullText)) continue;
    factors.set('sensitive_or_high_risk', factor('sensitive_or_high_risk', 'present', 'runtime_derived', [`risk_surface_pattern:${pattern.id}`], typeof intake.sensitive_or_high_risk === 'boolean' ? intake.sensitive_or_high_risk as boolean : null));
    if (pattern.id === 'medical_request' || pattern.id === 'legal_request' || pattern.id === 'financial_request') {
      factors.set('legal_medical_financial', factor('legal_medical_financial', 'present', 'runtime_derived', [`risk_surface_pattern:${pattern.id}`], typeof intake.legal_medical_financial === 'boolean' ? intake.legal_medical_financial as boolean : null));
    }
    if (pattern.id === 'irreversible_operation') factors.set('potential_downstream_execution', factor('potential_downstream_execution', 'present', 'runtime_derived', [`risk_surface_pattern:${pattern.id}`], typeof intake.potential_downstream_execution === 'boolean' ? intake.potential_downstream_execution as boolean : null));
  }

  if (DESTRUCTIVE_ACTION_PATTERN.test(fullText) || CONSEQUENTIAL_OPERATION_PATTERN.test(fullText)) {
    factors.set('potential_downstream_execution', factor('potential_downstream_execution', 'present', 'routing_signal', ['canonical_risk_surface:destructive_or_operational'], typeof intake.potential_downstream_execution === 'boolean' ? intake.potential_downstream_execution as boolean : null));
  }
  if (TOOL_ACTION_PATTERN.test(fullText)) {
    factors.set('uses_external_tools', factor('uses_external_tools', 'present', 'routing_signal', ['canonical_risk_surface:tool_or_execution'], typeof intake.uses_external_tools === 'boolean' ? intake.uses_external_tools as boolean : null));
  }
  if (surface.availableSources.length > 0) {
    factors.set('external_files', factor('external_files', 'present', 'runtime_derived', [`available_sources:${surface.availableSources.length}`], typeof intake.external_files === 'boolean' ? intake.external_files as boolean : null));
  }
  if (CURRENT_INFO_PATTERN.test(fullText)) factors.set('requires_current_information', factor('requires_current_information', 'present', 'runtime_derived', ['canonical_risk_surface:current_information'], typeof intake.requires_current_information === 'boolean' ? intake.requires_current_information as boolean : null));
  if (EXACT_CLAIM_PATTERN.test(fullText)) factors.set('exact_factual_claims', factor('exact_factual_claims', 'present', 'runtime_derived', ['canonical_risk_surface:exact_claim'], typeof intake.exact_factual_claims === 'boolean' ? intake.exact_factual_claims as boolean : null));

  const domainInputs = {
    ...(resolvedInputs ?? seedDomainInputs(envelope, routing.domain)),
    domain: routing.domain,
    canonical_risk_surface: surface,
    risk_surface_text: fullText,
    benign_operation: benignResolution.operation,
    complete_intent_covered: benignResolution.completeIntentCovered,
  };
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
  let classification: DerivedRisk;
  if (rank === 3) classification = 'high';
  else if (rank === 2) classification = 'medium';
  else if (benignComplete && unknowns.length === 0 && !ruleError) classification = 'low';
  else classification = 'unknown';
  if (routing.hint_conflict) classification = 'clarification_required';
  if (routing.domain === 'general' && classification !== 'low') classification = 'clarification_required';

  const consequentialPresent = [...factors.values()].some((item) => item.state === 'present' && ['uses_external_tools', 'potential_downstream_execution', 'requires_current_information', 'external_files', 'sensitive_or_high_risk', 'legal_medical_financial'].includes(item.factor_id));
  const reviewRequired = classification !== 'low' || consequentialPresent || intake.human_review_required === true;
  const signals: RiskAssessment['signals'] = [...factors.values()].map((item) => ({
    id: item.factor_id,
    value: item.state,
    source: item.source === 'caller_positive_hint' ? 'caller_hint' : 'derived',
  }));

  return {
    classification,
    factors: [...factors.values()].sort((a, b) => a.factor_id.localeCompare(b.factor_id)),
    applied_rules: appliedRules,
    benign_resolution: benignResolution,
    risk_surface: surface,
    unknowns,
    review_required: reviewRequired,
    decision: routing.hint_conflict
      ? 'domain hint conflicts with strong Runtime routing evidence'
      : classification === 'low'
        ? `closed-world benign operation fully covered: ${String(benignResolution.operation)}`
        : classification === 'clarification_required'
          ? 'selected route cannot support automatic authorization for unresolved or consequential intent'
          : classification === 'unknown'
            ? 'complete authority-relevant intent is not recognized as one closed benign operation'
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
