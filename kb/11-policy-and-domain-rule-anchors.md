---
title: "Policy and Domain Rule Anchors"
version: "2026.3"
status: "canonical"
---

# Policy and Domain Rule Anchors

<!-- peac-rule-id: state.no_hidden_state_claim -->
Generated prompts must not claim memory, hidden state, background work, saved telemetry, or persistent storage unless the deployment explicitly provides that capability.
<!-- /peac-rule-id -->

<!-- peac-rule-id: evidence.current_claims_need_sources -->
Prompts that require current, unstable, official, legal, medical, financial, security, API, or model-capability claims must require reliable evidence, recency checks, and clear uncertainty labels.
<!-- /peac-rule-id -->

<!-- peac-rule-id: output.no_hidden_or_fake_execution -->
Prompt artifacts must not leak hidden reasoning, dump irrelevant internal knowledge, fabricate execution results, or claim tool, repository, CI, memory, or background actions that did not occur.
<!-- /peac-rule-id -->

<!-- peac-rule-id: document_review.evidence_quality -->
Document reviews must separate source-backed findings, engineering heuristics, project-specific observations, and items needing verification.
<!-- /peac-rule-id -->

<!-- peac-rule-id: document_review.diagnose_integrate -->
Document reviews must go beyond summary: diagnose correctness, contradictions, terminology drift, conceptual relationships, and the best integration path.
<!-- /peac-rule-id -->

<!-- peac-rule-id: workflow.stateful_behavior_requires_carrier -->
Workflow designs must not claim durable state, retries, counters, memory, checkpoints, or monitoring unless an explicit external state carrier or orchestrator is named.
<!-- /peac-rule-id -->

<!-- peac-rule-id: workflow.eval_human_review_gates -->
AI workflows that affect high-impact outputs, tools, or downstream automation must define validation gates, evals, stop conditions, and human-review triggers.
<!-- /peac-rule-id -->

<!-- peac-rule-id: repo_review.evidence_first -->
Repository-review claims must be grounded in available repository files, diffs, logs, test outputs, CI results, or documentation.
<!-- /peac-rule-id -->

<!-- peac-rule-id: repo_review.no_unverified_results -->
Repository-review prompts must prohibit fabricated or unverified test results, command outputs, source paths, versions, CI status, release evidence, and file changes.
<!-- /peac-rule-id -->

<!-- peac-rule-id: repo_review.smallest_safe_patch -->
When patch guidance is requested, repository-review prompts should prefer the smallest safe patch over broad rewrites or unrelated refactors.
<!-- /peac-rule-id -->

<!-- peac-rule-id: repo_review.no_unconfirmed_merge -->
Repository-review prompts must not approve merge, release, publish, delete, force-push, or production-setting changes without explicit user approval and passing checks.
<!-- /peac-rule-id -->

<!-- peac-rule-id: coding_debugging.evidence_first -->
Code review and debugging claims must be grounded in available code, diffs, logs, errors, tests, stack traces, or documentation.
<!-- /peac-rule-id -->

<!-- peac-rule-id: coding_debugging.no_unverified_results -->
Coding review and debugging prompts must prohibit fabricated or unverified test results, command outputs, file paths, versions, passing CI claims, release evidence, and file changes.
<!-- /peac-rule-id -->

<!-- peac-rule-id: coding_debugging.patch_only -->
Code-change prompts should prefer the smallest safe patch that addresses the confirmed issue and avoid unrelated rewrites.
<!-- /peac-rule-id -->

<!-- peac-rule-id: coding_debugging.tests_required -->
Code-change prompts should request relevant tests, regression checks, or explicit test gaps before release or merge readiness claims.
<!-- /peac-rule-id -->

<!-- peac-rule-id: coding_debugging.root_cause_uncertainty -->
Debugging prompts must separate confirmed evidence, likely causes, hypotheses, remaining unknowns, and verification steps.
<!-- /peac-rule-id -->
