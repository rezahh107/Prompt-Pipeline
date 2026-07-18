# Next Work — Prompt Quality and Migration Program

This file is the **single mutable current-status authority** for the Prompt Quality and Migration execution program. The machine-readable program remains normative for task identities, dependencies, and derived eligibility.

<!-- prompt-quality-status:start -->
```json
{
  "active_program": "PROMPT-QUALITY-MIGRATION-EXECUTION-PROGRAM",
  "authoritative_activation_state": "candidate_pending_merge",
  "current_status_authority": "planning/NEXT_WORK.md",
  "durable_execution_plan_authority": "planning/PROMPT_QUALITY_EXECUTION_PLAN.md",
  "machine_readable_program_authority": "planning/prompt-quality/prompt-quality-execution-program.v1.json",
  "current_immediately_executable_task": "PPQR-001",
  "dependency_blocked_tasks": [
    "PPQR-002",
    "PPQR-003",
    "PPQR-004",
    "PPQR-005",
    "PPQR-006",
    "PPQR-007",
    "PPQR-008",
    "PPQR-009",
    "PPQR-010",
    "PPQR-011",
    "PPQR-012",
    "PPQR-013",
    "PPQR-014",
    "PPQR-015"
  ],
  "quality_promotion_effect": false,
  "migration_promotion_effect": "none",
  "production_authority_effect": "none",
  "activation_validation_state": "pending_exact_head_ci",
  "merge_state": "pending_owner_merge",
  "exact_main_state": "pending",
  "latest_impact": "planning/prompt-quality/impacts/0001-PROMPT-QUALITY-PROGRAM-ACTIVATION.json",
  "current_scope": "planning/prompt-quality/scopes/PROMPT-QUALITY-PROGRAM-ACTIVATION.scope.json"
}
```
<!-- prompt-quality-status:end -->

## Current decision

The governance activation is implemented on a feature branch and remains `candidate_pending_merge`. It carries no quality credit, migration promotion, production-authority change, release-readiness claim, production-readiness claim, or legacy-retirement effect.

## Registered architecture amendment

`Repository Implementation Assurance Lite` is now registered as bounded future work inside the existing `PPQR-001` through `PPQR-015` sequence. It is an adaptive cross-cutting profile, not a new domain, not a sixteenth task, and not a target-repository enforcement platform.

The future pilot is limited to one linked `assurance-lite.yaml` artifact beside the implementation prompt, structural validation inside Prompt-Pipeline, required implementer reporting, and downstream independent review by `PR-Inspector`. It remains non-authoritative and non-blocking until `PPQR-010` demonstrates measurable defect reduction after accounting for token, execution, review, and cycle-time overhead.

This registration implements no Assurance Lite runtime schema, renderer, routing behavior, model execution, target-repository gate, semantic judge, migration promotion, or substantive `PPQR` deliverable. The registration itself is schema-constrained and synchronized below for governance validation.

<!-- repository-implementation-assurance-lite:start -->
```json
{
  "architecture_key": "repository_implementation_assurance_lite",
  "architecture_revision": "sha256:d34599ca0858231a66ce7de35d53ceb7c1494a5353711b8547f3ad9af7f866b1",
  "registration": {
    "status": "registered_future_work",
    "role": "cross_cutting_adaptive_profile",
    "new_domain_required": false,
    "new_task_required": false,
    "profile_name": "assurance_lite",
    "selection_basis": [
      "consumer_path",
      "risk_tier",
      "task_complexity"
    ],
    "activation_mode": "adaptive",
    "simple_requests_default": "disabled",
    "bundle_shape": "implementation_prompt_plus_one_linked_assurance_artifact",
    "artifact_name": "assurance-lite.yaml",
    "required_sections": [
      "requirements",
      "risks",
      "acceptance_and_evidence",
      "implementation_report_contract"
    ],
    "structural_validation": [
      "schema_validity",
      "identifier_uniqueness",
      "requirement_to_acceptance_mapping",
      "high_or_critical_risk_to_mitigation_and_verification_mapping",
      "cross_reference_completeness",
      "forbidden_lifecycle_claims"
    ],
    "implementation_report_required_fields": [
      "requirement_id",
      "status",
      "changed_files",
      "tests",
      "evidence",
      "residual_risks"
    ],
    "states": [
      "declared",
      "implemented",
      "verified"
    ],
    "target_repository_validator_required_for_initial_pilot": false,
    "downstream_independent_review": "PR-Inspector",
    "initial_authority": "non_authoritative_non_blocking",
    "task_integration": {
      "PPQR-001": [
        "measure baseline defects and repair-cycle cost",
        "classify PR-Inspector findings by preventability"
      ],
      "PPQR-002": [
        "select none or lite adaptively for repository-modification consumer paths"
      ],
      "PPQR-003": [
        "define the schema-first single-artifact contract"
      ],
      "PPQR-004": [
        "define structural mapping and lifecycle-claim rules"
      ],
      "PPQR-005": [
        "render and bind the linked artifact to the implementation prompt"
      ],
      "PPQR-006": [
        "pilot valid, invalid, and adversarial cases non-blockingly"
      ],
      "PPQR-007": [
        "implement bounded structural validation and stable diagnostics"
      ],
      "PPQR-009": [
        "bind activation to risk tier and measure overhead"
      ],
      "PPQR-010": [
        "decide promotion from held-out quality delta and cost evidence"
      ],
      "PPQR-012": [
        "prove cross-domain containment"
      ],
      "PPQR-015": [
        "prevent silent fallback activation"
      ]
    },
    "promotion_requires": [
      "held_out_quality_delta_evidence",
      "reduced_first_review_critical_or_high_findings_or_repair_cycles",
      "measured_token_execution_review_and_cycle_time_overhead",
      "no_material_cross_domain_leakage"
    ],
    "not_claimed": [
      "semantic_correctness",
      "target_repository_enforcement",
      "implementation_completion",
      "merge_readiness",
      "exact_main_validation",
      "zero_defect_guarantee"
    ]
  }
}
```
<!-- repository-implementation-assurance-lite:end -->

## Exact next executable task

`PPQR-001 — Program Ledger and Legacy Quality Baseline`

`PPQR-001` is the only dependency-free substantive task. `PPQR-002` through `PPQR-015` remain registered and authorized but dependency-blocked until their declared predecessors are complete.

## Completion boundary

A feature branch or successful CI run does not make a task complete. Completion requires implementation evidence, exact-head CI, repository-memory synchronization, owner-controlled merge, and exact current-main verification.
