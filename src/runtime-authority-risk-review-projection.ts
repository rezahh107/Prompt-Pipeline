import type { RiskAssessment } from './runtime-authority-foundation.js';

export interface RiskReviewCompatibilityProjection {
  legacyRiskLevel: 'low' | 'medium' | 'high';
  requiresHumanReview: boolean;
  reviewReason: string | null;
}

export function deriveRiskReviewCompatibility(
  risk: Pick<RiskAssessment, 'classification' | 'review_required' | 'decision'>,
): RiskReviewCompatibilityProjection {
  const legacyRiskLevel = risk.classification === 'low'
    ? 'low'
    : risk.classification === 'medium'
      ? 'medium'
      : 'high';
  return {
    legacyRiskLevel,
    requiresHumanReview: risk.review_required,
    reviewReason: risk.review_required ? risk.decision : null,
  };
}
