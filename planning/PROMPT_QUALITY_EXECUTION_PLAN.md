# Prompt Quality and Migration Execution Plan

## Authority boundary

This document is the durable architecture, rationale, sequencing, and policy authority. It does not carry mutable Task status.

- Mutable current status: `planning/NEXT_WORK.md`
- Machine-readable Task program: `planning/prompt-quality/prompt-quality-execution-program.v2.json`
- Native repository evidence: Git commit SHA, Git history and ancestry, GitHub PR metadata, and GitHub Checks

## Operating model

The active target model is `BALANCED_PERSONAL_REPOSITORY`.

The repository preserves controls that materially improve prompt quality, deterministic validation, regression detection, reproducibility, truthful reporting, provenance, recoverability, and basic security. Enterprise-style administrative evidence is retired from active use when Git and GitHub already provide the authoritative fact.

## Blocking quality and integrity controls

The canonical CI pipeline continues to enforce, where currently present:

- schema and static validation;
- deterministic valid and invalid cases;
- routing and subtype-selection tests;
- output-contract checks;
- behavioral-rule coverage;
- knowledge and rule drift checks;
- production-grade input requirements;
- model-profile and context-policy checks;
- human-review rules for genuinely high-risk artifacts;
- artifact metadata, provenance, and path containment;
- exact tested commit verification;
- frozen dependency installation;
- supported Node matrix;
- PR-Inspector renderer and consumer compatibility;
- bundle and smoke validation.

No quality control is made advisory by this governance simplification.

## Evidence and validation claims

GitHub and Git are authoritative for external repository events. The active model does not require repository copies of Merge actors, raw PR payloads, workflow artifact receipts, exact-head receipts, exact-main receipts, or projection digests.

A validation claim must report:

```yaml
validation_status: passed | failed | not_run | unavailable
tested_commit: <sha-or-null>
source: github_actions | local | unavailable
commands:
  - <executed-command>
ci_run_reference: <run-id-or-null>
```

A successful check for one commit does not validate another commit.

## Task state and eligibility

Task state is limited to:

```text
not_started
active
blocked
complete
```

Eligibility is derived from completed dependencies and explicit blockers. A Task may be marked `complete` only with a recorded successful quality-validation claim tied to a tested commit.

Eligibility does not depend on owner-Merge receipts, exact-main receipts, lifecycle event order, impact hashes, receipt replay checks, or post-Merge administrative reconciliation.

`PPQR-001` is dependency-free, eligible, and `not_started`. This plan does not implement it.

## Risk-based Scope policy

### Routine changes

Examples include documentation, planning status, ordinary tests and fixtures, prompt templates, non-destructive validator fixes, and local refactoring.

Required controls:

- clear PR summary;
- changed-file review;
- canonical CI;
- ordinary review.

Routine work does not require an immutable Scope revision, authorization commit, exact-file receipt, or lifecycle ceremony.

### High-risk or cross-cutting changes

Examples include `.github/workflows/**`, public schemas, authentication or authorization, security controls, dependency upgrades, destructive migrations, production routing, release authority, secret handling, and repository permissions.

Required controls:

- explicit scope summary;
- risk statement;
- rollback or recovery notes;
- independent review;
- path-sensitive checks where useful;
- canonical CI.

## Independent review policy

- High-risk or cross-cutting change: independent review required.
- Routine low-risk change: independent review advisory or sampled.

PR-Inspector renderer and consumer compatibility tests remain in CI. A fresh independent review is not required after every documentation, status, or low-risk maintenance commit.

## Historical governance model

The v1 program, Scope records, lifecycle ledgers, evidence receipts, impact records, hash chains, and their schemas are preserved as read-only history. They are excluded from active Task completion and current-status decisions.

Do not append new receipts, lifecycle events, Scope amendments, impact entries, or governance hashes. Do not recompute historical hashes.

See `planning/prompt-quality/DEPRECATION.md`.

## Approved architecture retained

### Quality-first hybrid evaluation

Repository artifacts remain authoritative for quality definitions, rules, corpora, thresholds, migration readiness, production routing, Task completion, and release approval. External harnesses may execute models and return raw evidence only.

### Domain contracts

Future domain contracts remain JSON Schema-first and must distinguish required, optional, conditional, forbidden, clarification, default, trust-boundary, output-obligation, and risk-trigger semantics.

### Executable rules and thin templates

Rules must have applicability, carriers, validators, mutations, diagnostics, and gates. Templates own presentation and ordering, not domain authority or migration state.

### Domain quality packs and semantic evaluation

Development, release, and regression corpora remain the default. Semantic evaluation begins non-blocking and cannot become authoritative without calibration, false-pass measurement, bias controls, and cross-domain evidence.

### Risk-tiered evaluation and model profiles

Evaluation depth derives from domain subtype, consumer path, and execution profile. Model support remains profile-versioned and conformance-derived.

### Migration authority

Exactly one path may be production-authoritative. `Migration Promotion Gate` remains the sole transition authority, with `Quality Delta Gate` as a required subgate.

### Complexity budget

No universal Prompt IR, arbitrary metadata blob, unbounded nesting, prompt graph, or general reasoning-plan hierarchy is authorized.

### Repository Implementation Assurance Lite

Assurance Lite remains future, adaptive, non-authoritative work inside the existing PPQR sequence. It is enabled only when consumer path, risk tier, or task complexity justifies the overhead. Promotion requires held-out evidence of reduced important defects or repair cycles after accounting for cost.

## Task sequence

The exact titles, purposes, and dependencies for `PPQR-001` through `PPQR-015` are normative in `prompt-quality-execution-program.v2.json`. The approved dependency order is unchanged by this simplification.
