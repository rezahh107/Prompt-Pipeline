import type { Dict, PEaCConfig } from './peac.js';
import {
  type BenignOperation,
  type RiskAssessment,
  type RiskFactorAssessment,
  type RoutingDecision,
  type RuntimePlanAssessment,
  type ValidatedIntakeEnvelope,
} from './runtime-authority-foundation.js';
import {
  compileRuntimePlan as compileRuntimePlanLegacy,
  validateContractForTest,
} from './runtime-authority-plan.js';
import {
  buildCanonicalRiskSurface,
  buildRoutingDecision,
  deriveRisk as deriveRiskLegacy,
  resolveBenignOperation,
  seedDomainInputs,
} from './runtime-authority-risk.js';

export type PayloadKind =
  | 'none'
  | 'bounded_literal'
  | 'inline_free_form'
  | 'referenced_or_unavailable';

export interface BenignOperationPayloadPolicy {
  operation: BenignOperation;
  allowedPayloadKinds: readonly PayloadKind[];
  payloadProof: 'none_required' | 'bounded_deterministic';
}

export interface BenignPayloadAssessment {
  kind: PayloadKind;
  provenBenign: boolean;
  payloadSources: string[];
  unresolvedReasons: string[];
}

const SIMPLE_GRAMMAR_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'book', 'boy', 'cat', 'child', 'class', 'dog', 'friend',
  'girl', 'go', 'goes', 'good', 'has', 'have', 'he', 'home', 'i', 'in', 'is', 'it', 'learn',
  'likes', 'love', 'my', 'read', 'reads', 'school', 'she', 'student', 'teacher', 'the', 'they',
  'to', 'we', 'work', 'works', 'you', 'your',
]);

export const BENIGN_OPERATION_PAYLOAD_POLICIES = {
  short_greeting: {
    operation: 'short_greeting',
    allowedPayloadKinds: ['none', 'bounded_literal'],
    payloadProof: 'bounded_deterministic',
  },
  birthday_or_congratulation_message: {
    operation: 'birthday_or_congratulation_message',
    allowedPayloadKinds: ['none', 'bounded_literal'],
    payloadProof: 'bounded_deterministic',
  },
  grammar_correction_of_provided_text: {
    operation: 'grammar_correction_of_provided_text',
    allowedPayloadKinds: ['bounded_literal'],
    payloadProof: 'bounded_deterministic',
  },
  rewrite_of_provided_text: {
    operation: 'rewrite_of_provided_text',
    allowedPayloadKinds: ['none'],
    payloadProof: 'none_required',
  },
  summary_of_provided_text: {
    operation: 'summary_of_provided_text',
    allowedPayloadKinds: ['none'],
    payloadProof: 'none_required',
  },
  non_operational_name_brainstorm: {
    operation: 'non_operational_name_brainstorm',
    allowedPayloadKinds: ['none', 'bounded_literal'],
    payloadProof: 'bounded_deterministic',
  },
  non_instructional_creative_poem: {
    operation: 'non_instructional_creative_poem',
    allowedPayloadKinds: ['none', 'bounded_literal'],
    payloadProof: 'bounded_deterministic',
  },
} as const satisfies Record<BenignOperation, BenignOperationPayloadPolicy>;

const GENERIC_DESIRED_OUTPUTS = new Set([
  '',
  'a short reusable prompt',
  'a short message',
  'birthday wish',
  'congratulation message',
  'corrected sentence',
  'list of names',
  'message',
  'poem',
  'prompt',
  'short message',
  'summary',
  'text',
]);

const BOUNDED_CONSTRAINTS = new Set([
  'concise',
  'friendly',
  'grammar only',
  'keep the meaning',
  'no explanation',
  'one sentence',
  'plain text',
  'preserve meaning',
  'short',
]);

function normalize(value: unknown): string {
  return String(value ?? '').replace(/[\s\r\n\t]+/g, ' ').trim();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(normalize).filter(Boolean).sort() : [];
}

function boundedGrammarLiteral(request: string): boolean {
  const separator = request.indexOf(':');
  if (separator < 0) return false;
  const literal = request.slice(separator + 1).trim();
  if (!/^[A-Za-z][A-Za-z' ]{1,78}\.$/.test(literal)) return false;
  const words = literal.slice(0, -1).toLowerCase().split(/\s+/);
  return words.length <= 12 && words.every((word) => SIMPLE_GRAMMAR_WORDS.has(word));
}

function boundedTopicLiteral(request: string): boolean {
  const match = request.match(/\b(?:for|about)\s+([A-Za-z][A-Za-z0-9 -]{0,40})\.?$/i);
  if (!match) return false;
  const topic = match[1].trim();
  return /^[A-Za-z][A-Za-z0-9 -]{0,40}$/.test(topic) && !/[;:]/.test(topic);
}

function requestCarriesFreeFormPayload(operation: BenignOperation, request: string): boolean {
  if (operation === 'grammar_correction_of_provided_text') return request.includes(':') && !boundedGrammarLiteral(request);
  if (operation === 'rewrite_of_provided_text') return request.includes(':');
  if (operation === 'non_operational_name_brainstorm' || operation === 'non_instructional_creative_poem') {
    return /\b(?:for|about)\b/i.test(request) && !boundedTopicLiteral(request);
  }
  return false;
}

function requestCarriesBoundedLiteral(operation: BenignOperation, request: string): boolean {
  if (operation === 'grammar_correction_of_provided_text') return boundedGrammarLiteral(request);
  if (operation === 'non_operational_name_brainstorm' || operation === 'non_instructional_creative_poem') return boundedTopicLiteral(request);
  return false;
}

export function assertBenignOperationPolicyInventory(operations: readonly string[]): void {
  const policyKeys = Object.keys(BENIGN_OPERATION_PAYLOAD_POLICIES).sort();
  const expected = [...operations].sort();
  const missing = expected.filter((operation) => !policyKeys.includes(operation));
  const unexpected = policyKeys.filter((operation) => !expected.includes(operation));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`BenignOperation payload policy inventory mismatch; missing=${missing.join(',') || 'none'}; unexpected=${unexpected.join(',') || 'none'}`);
  }
}

export function assessBenignPayload(
  envelope: ValidatedIntakeEnvelope,
  risk: RiskAssessment,
): BenignPayloadAssessment {
  const operation = risk.benign_resolution.operation;
  const intake = envelope.normalized_inputs;
  const payloadSources: string[] = [];
  const unresolvedReasons: string[] = [];
  const request = normalize(intake.request);
  const desiredOutput = normalize(intake.desired_output).toLowerCase();
  const constraints = stringArray(intake.constraints).map((item) => item.toLowerCase());
  const requestedActions = stringArray(intake.requested_actions);
  const availableSources = stringArray(intake.available_sources);
  const contextItems = Array.isArray(intake.context_items) ? intake.context_items : [];
  const consumerPath = normalize(intake.consumer_path);
  const modelInteractionMode = normalize(intake.model_interaction_mode);
  const targetEnvironment = normalize(intake.target_environment);

  if (availableSources.length > 0) payloadSources.push(...availableSources.map((item) => `available_sources:${item}`));
  if (contextItems.length > 0) payloadSources.push(`context_items:${contextItems.length}`);
  if (requestedActions.length > 0) payloadSources.push(...requestedActions.map((item) => `requested_actions:${item}`));
  if (consumerPath) payloadSources.push(`consumer_path:${consumerPath}`);
  if (modelInteractionMode) payloadSources.push(`model_interaction_mode:${modelInteractionMode}`);
  if (targetEnvironment && !['chatgpt', 'unspecified', 'local'].includes(targetEnvironment.toLowerCase())) payloadSources.push(`target_environment:${targetEnvironment}`);
  for (const constraint of constraints) if (!BOUNDED_CONSTRAINTS.has(constraint)) payloadSources.push(`constraints:${constraint}`);
  if (!GENERIC_DESIRED_OUTPUTS.has(desiredOutput)) payloadSources.push(`desired_output:${desiredOutput}`);

  let kind: PayloadKind = 'none';
  if (availableSources.length > 0 || contextItems.length > 0) kind = 'referenced_or_unavailable';
  else if (operation && requestCarriesFreeFormPayload(operation, request)) kind = 'inline_free_form';
  else if (operation && requestCarriesBoundedLiteral(operation, request)) kind = 'bounded_literal';
  else if (payloadSources.length > 0) kind = 'inline_free_form';

  if (!operation) unresolvedReasons.push('no_supported_benign_operation');
  if (operation) {
    const policy = BENIGN_OPERATION_PAYLOAD_POLICIES[operation];
    if (!(policy.allowedPayloadKinds as readonly PayloadKind[]).includes(kind)) unresolvedReasons.push(`payload_kind_not_allowed:${operation}:${kind}`);
  }
  if (risk.benign_resolution.secondaryActions.length > 0) unresolvedReasons.push('secondary_action_present');
  if (risk.benign_resolution.consequentialSignals.length > 0) unresolvedReasons.push('consequential_control_instruction_present');
  if (risk.benign_resolution.unresolvedClauses.length > 0) unresolvedReasons.push(...risk.benign_resolution.unresolvedClauses.map((item) => `legacy_unresolved:${item}`));

  return {
    kind,
    provenBenign: Boolean(operation) && unresolvedReasons.length === 0,
    payloadSources: [...new Set(payloadSources)].sort(),
    unresolvedReasons: [...new Set(unresolvedReasons)].sort(),
  };
}

function invalidateCallerAbsence(factor: RiskFactorAssessment, assessment: BenignPayloadAssessment): RiskFactorAssessment {
  if (factor.state !== 'absent') return factor;
  return {
    ...factor,
    state: 'unknown',
    source: 'configured_default',
    evidence: [
      ...factor.evidence.filter((item) => !item.startsWith('closed_world_benign:')),
      `payload_proof_incomplete:${assessment.kind}`,
      ...(factor.caller_claim === false ? [`caller_negative_claim_not_authoritative:${factor.factor_id}=false`] : []),
    ].sort(),
  };
}

function applyPayloadAssessmentToRisk(
  envelope: ValidatedIntakeEnvelope,
  routing: RoutingDecision,
  risk: RiskAssessment,
): RiskAssessment & { payload_assessment: BenignPayloadAssessment } {
  const assessment = assessBenignPayload(envelope, risk);
  const result = risk as RiskAssessment & { payload_assessment: BenignPayloadAssessment };
  result.payload_assessment = assessment;

  if (!assessment.provenBenign) {
    result.factors = result.factors.map((factor) => invalidateCallerAbsence(factor, assessment));
    result.unknowns = [...new Set([
      ...result.unknowns,
      ...result.factors.filter((factor) => factor.state === 'unknown').map((factor) => factor.factor_id),
      ...assessment.unresolvedReasons.map((reason) => `payload:${reason}`),
    ])].sort();
    result.benign_resolution.completeIntentCovered = false;
    result.benign_resolution.unresolvedClauses = [...new Set([
      ...result.benign_resolution.unresolvedClauses,
      ...assessment.unresolvedReasons,
    ])].sort();
    if (result.classification === 'low') {
      result.classification = routing.domain === 'general' ? 'clarification_required' : 'unknown';
    }
    result.review_required = true;
    result.decision = `benign operation payload is not proven by its exhaustive policy: ${assessment.kind}`;
  }
  return result;
}

function applyPayloadAssessment(plan: RuntimePlanAssessment): RuntimePlanAssessment {
  const risk = applyPayloadAssessmentToRisk(plan.validatedIntake, plan.routing, plan.risk);
  plan.risk = risk;
  plan.generationPlan.risk = risk;
  if (plan.validatedIntake.source_mode !== 'fixture_validation') {
    plan.generationPlan.publication.intended_authority_state = risk.review_required ? 'review_pending' : 'authorized';
  }
  return plan;
}

export function deriveRisk(
  envelope: ValidatedIntakeEnvelope,
  routing: RoutingDecision,
  configOverride?: PEaCConfig,
  resolvedInputs?: Dict,
): RiskAssessment {
  return applyPayloadAssessmentToRisk(
    envelope,
    routing,
    deriveRiskLegacy(envelope, routing, configOverride, resolvedInputs),
  );
}

export function compileRuntimePlan(
  envelope: ValidatedIntakeEnvelope,
  configOverride?: PEaCConfig,
): RuntimePlanAssessment {
  return applyPayloadAssessment(compileRuntimePlanLegacy(envelope, configOverride));
}

export function compileGenerationPlan(
  envelope: ValidatedIntakeEnvelope,
  configOverride?: PEaCConfig,
) {
  return compileRuntimePlan(envelope, configOverride).generationPlan;
}

export {
  buildCanonicalRiskSurface,
  buildRoutingDecision,
  resolveBenignOperation,
  seedDomainInputs,
  validateContractForTest,
};

export function payloadAssessmentForTest(
  envelope: ValidatedIntakeEnvelope,
  configOverride?: PEaCConfig,
): BenignPayloadAssessment {
  return (compileRuntimePlan(envelope, configOverride).risk as RiskAssessment & { payload_assessment: BenignPayloadAssessment }).payload_assessment;
}

export function syntheticPolicyInventoryFailureForTest(): void {
  assertBenignOperationPolicyInventory([
    ...Object.keys(BENIGN_OPERATION_PAYLOAD_POLICIES),
    'synthetic_missing_operation',
  ]);
}
