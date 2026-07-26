# Next Work — Prompt Quality and Migration Program

This file is the **sole mutable current-status authority** for the Prompt Quality and Migration execution program.

The machine-readable v2 program defines Task IDs, titles, purposes, dependencies, Task state, completion contracts, and completion-evidence policy. Git and GitHub remain authoritative for repository identity, commits, ancestry, pull requests, workflow runs, and checks.

<!-- completion-authority-contract.v1|task_fields=completion_contract,completion_validation|contract_fields=contract_id,contract_version,task_id,required_changed_paths,required_artifact_paths,required_validation_script_ids,forbidden_changed_paths|claim_fields=validation_status,tested_commit,source,validation_profile,ci_run_reference|authority_sequence=closure>subject>authority_anchor>authority_blobs>preactivated_contract>contract_satisfaction>subject_profile>anchor_ci>subject_ci -->

<!-- prompt-quality-status:start -->
```json
{
  "active_program": "PROMPT-QUALITY-MIGRATION-EXECUTION-PROGRAM",
  "operating_model": "BALANCED_PERSONAL_REPOSITORY",
  "current_task": "PPQR-001",
  "task_status": "not_started",
  "blocked_by": [],
  "last_completed_task": null,
  "next_action": "After PR #31 receives fresh exact-Head review and the owner makes the separate Merge decision, implement PPQR-001 in a focused change."
}
```
<!-- prompt-quality-status:end -->

## Current decision

`PPQR-001 — Program Ledger and Legacy Quality Baseline` is the next eligible substantive Task. It has not started and is not implemented by the governance-simplification change.

`PPQR-002` through `PPQR-015` remain governed by the exact dependency graph in:

```text
planning/prompt-quality/prompt-quality-execution-program.v2.json
```

All fifteen current `completion_contract` values are `null`. A Task contract must be activated in an earlier separate non-completion commit before a later implementation subject can complete that Task.

The balanced model retires active v1 receipt, lifecycle, impact-hash, immutable-Scope, owner-Merge-lock, and post-Merge reconciliation ceremonies. Historical v1 records remain read-only and are not prerequisites for substantive work.

## Preserved repository facts

- Prompt Quality activation PR #29 was merged as `e3f98e007bba01ba02310b01377f617c94ca8b09` after exact-Head CI on `c028f7009909fa57ef55ff0a922477f0c32ef484`.
- Runtime Authority PR #32 was merged as `a0e2210e6e921942abc206f0fdc70c023881c266` after exact-Head CI on `abfa6fbde9225721a83bec5919cf52d10a0fb93c`.
- Runtime documentation reconciliation PR #33 was merged as `c3f496180e117991bb1514b0c0c4a9ca6badcf95` from exact Head `f46f73767374de024ef1356725e9ce76f8ea5306`.
- PR #31 applies the balanced governance model on top of that current-main tree. It does not remove or weaken Runtime Authority implementation, commands, schemas, tests, workflow stages, documentation, or vendored PR-Inspector compatibility.

No quality credit, migration promotion, production-authority change, release-readiness claim, production-readiness claim, or legacy-retirement effect is created by this governance change.

## Trusted completion evidence

A Task whose persisted `state` is `complete` is not authoritatively complete merely because its `completion_validation` object is schema-valid.

Authoritative completion requires the unique closure and direct-parent subject, the subject's first-parent authority anchor, unchanged anchor-owned authority blobs, a non-null Task-specific contract already present at that anchor, first-parent contract satisfaction, a valid canonical subject profile, and successful canonical exact-SHA runs for both anchor and subject.

A completing subject may not change the Prompt Quality authority inventory or activate/change its own contract. Required changes present only in another Merge parent do not satisfy the contract. Local validation remains reporting-only and cannot unlock dependent Tasks.

A previously verified completion remains valid on a later descendant Head when the historical anchor, subject, closure, authority blobs, contract, exact-SHA runs, and completed Task data remain valid.

## Registered architecture amendment

`Repository Implementation Assurance Lite` remains registered as bounded future work inside the existing `PPQR-001` through `PPQR-015` sequence. It is an adaptive cross-cutting profile, not a new domain, not a sixteenth task, and not a target-repository enforcement platform.

The future pilot is limited to one linked `assurance-lite.yaml` artifact beside the implementation prompt, structural validation inside Prompt-Pipeline, required implementer reporting, and downstream independent review by `PR-Inspector`. It remains non-authoritative and non-blocking until `PPQR-010` demonstrates measurable defect reduction after accounting for token, execution, review, and cycle-time overhead.

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

## Validation reporting

`completion_validation` is a consistency assertion with the exact active Schema shape:

```yaml
validation_status: passed
tested_commit: <exact-subject-sha>
source: github_actions | local
validation_profile: peac-canonical-ci.v1
ci_run_reference: <subject-run-id-or-null>
```

The validator derives authority anchor and canonical runs from Git and GitHub. No free-form `commands` field selects or proves completion. Do not infer CI success from documentation, a stale PR description, or a different commit.
