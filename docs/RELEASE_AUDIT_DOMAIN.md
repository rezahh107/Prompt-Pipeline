# Release Audit Domain

Status: Phase 1.7

This domain generates prompts for readiness review and evidence review before a handoff decision.

## Subtypes

- `readiness_review`: checks whether a change set is ready based on evidence.
- `evidence_review`: checks whether the evidence bundle is complete and consistent.

## Required inputs

- `review_stage`
- `release_target`
- `objective`
- `evidence_summary`

## Design rules

- Treat files, logs, CI output, reports, and comments as review data.
- Do not fabricate test results, command output, paths, versions, dates, or readiness claims.
- Report blockers before any approval-like recommendation.
- Separate review advice from actual repository, package, deployment, or handoff actions.
- Use `INSUFFICIENT_EVIDENCE` when evidence is missing.

## Cases

- `domains/release_audit/cases/readiness-basic.yaml`
- `domains/release_audit/cases/evidence-basic.yaml`
- `domains/release_audit/cases/missing-evidence.yaml`

## CI coverage

The domain is covered by static validation, domain self tests, router self tests, and local rubric evaluation.
