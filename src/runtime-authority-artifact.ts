import {
  type AssuranceProjection,
  type CanonicalDerivedProjection,
  type CanonicalPolicyProjection,
  type CompletedRuntimeAssessment,
  type GoverningSource,
} from './runtime-authority-foundation.js';
import { deriveRiskReviewCompatibility } from './runtime-authority-risk-review-projection.js';

function assuranceProjection(completed: CompletedRuntimeAssessment): AssuranceProjection {
  return {
    profile: completed.plan.generationPlan.evaluation.profile,
    validation_kind: 'static_prompt_and_metadata_only',
    target_model_executed: false,
    behavioral_success_observed: false,
    semantic_correctness_claimed: false,
  };
}

function policyProjection(completed: CompletedRuntimeAssessment): CanonicalPolicyProjection[] {
  return completed.plan.policies.applied.map((item) => ({
    id: item.rule_id,
    source_ref: item.source_path,
    source_hash: item.source_sha256,
    triggered_by: item.trigger_evidence.join(' OR '),
  })).sort((a, b) => a.id.localeCompare(b.id));
}

function templateSource(sources: readonly GoverningSource[]): string | null {
  return sources.find((item) => /[\\/]templates[\\/]/.test(item.path))?.path ?? null;
}

/**
 * Pure compatibility projection only.
 *
 * Authority-bearing generation, verification, review capability issuance, and
 * CLI adaptation are intentionally owned by their canonical Runtime modules.
 */
export function buildCanonicalDerivedProjection(
  completed: CompletedRuntimeAssessment,
): CanonicalDerivedProjection {
  const plan = completed.plan;
  const generationPlan = plan.generationPlan;
  const normalized = generationPlan.intake.normalized_inputs;
  const sources = [...plan.governingSources].sort((a, b) => a.path.localeCompare(b.path));
  const riskReview = deriveRiskReviewCompatibility(plan.risk);
  return {
    generationPlan,
    validationLedger: completed.validationLedger,
    compatibilityValidation: completed.compatibilityValidation,
    routing: plan.routing,
    risk: plan.risk,
    ...riskReview,
    assurance: assuranceProjection(completed),
    contextAttribution: { state: plan.context.attribution_state, items: plan.context.items },
    domain: plan.routing.domain,
    subtype: plan.routing.subtype,
    provenance: {
      user_request: String(normalized.request ?? ''),
      case_file: plan.validatedIntake.source_mode === 'fixture_validation' ? 'fixture_validation' : null,
      routing_method: plan.routing.method,
      routing_confidence: plan.routing.confidence,
      routing_evidence: [...plan.routing.evidence],
      template_used: templateSource(sources),
      template_version: generationPlan.contract.version,
      inputs_provided: Object.keys(normalized).sort(),
      inputs_inferred: [],
      inputs_defaulted: [...generationPlan.contract.defaulted_inputs],
      canonical_intake_digest: plan.validatedIntake.intake_digest,
      checkout: completed.checkoutIdentity,
    },
    policiesApplied: policyProjection(completed),
    governingSources: sources,
    sourceHashes: { sources },
  };
}
