# Prompt Quality and Migration Execution Plan

<!-- completion-authority-contract.v1|task_fields=completion_contract,completion_validation|contract_fields=contract_id,contract_version,task_id,required_changed_paths,required_artifact_paths,required_validation_script_ids,forbidden_changed_paths|claim_fields=validation_status,tested_commit,source,validation_profile,ci_run_reference|authority_sequence=closure>subject>authority_anchor>authority_blobs>preactivated_contract>contract_satisfaction>subject_profile>anchor_ci>subject_ci -->

## Authority boundary

This document is the durable architecture, rationale, sequencing, and policy authority. It does not carry mutable Task status.

- Mutable current status: `planning/NEXT_WORK.md`
- Machine-readable Task and dependency authority: `planning/prompt-quality/prompt-quality-execution-program.v2.json`
- Historical v1 records: read-only under `planning/prompt-quality/`
- Repository and validation facts: Git and GitHub
- Runtime behavior and authority: the existing Runtime Authority sources, schemas, tests, workflow stages, and `pipeline/RUNTIME_AUTHORITY.md`

## Operating model

The active target model is `BALANCED_PERSONAL_REPOSITORY`.

The repository preserves controls that materially improve prompt quality, deterministic validation, regression detection, reproducibility, truthful reporting, provenance, recoverability, and basic security. Enterprise-style administrative evidence is retired from active use when Git and GitHub already provide the authoritative fact.

## Current-main integration invariant

The balanced governance model is applied to the current `main` tree, not to the obsolete PR #31 base.

The final tree must preserve:

- `peac:verify-artifact`, `peac:review-artifact`, `peac:runtime-authority-test`, and `peac:runtime-cli-help`;
- smoke generation in `ci` mode;
- the full Runtime Authority source, schema, policy, and test surface;
- exact tested-commit checkout and the existing Node 20/22 matrix;
- vendored exact-blob PR-Inspector v1.11.1 compatibility verification;
- truthful PR #29, PR #32, and PR #33 repository facts;
- `Repository Implementation Assurance Lite` as registered future work.

Conflict resolution may not accept obsolete shared files wholesale or create parallel Runtime or status authorities.

## Blocking quality and integrity controls

Canonical CI continues to enforce:

- schema and static validation;
- deterministic valid and invalid cases;
- routing and subtype-selection tests;
- output-contract and behavioral-rule coverage;
- knowledge and rule drift checks;
- production-grade input requirements;
- model-profile and context-policy checks;
- artifact metadata, provenance, and path containment;
- Runtime Authority invariants and CLI help;
- PR-Inspector renderer and pack checks;
- bundle and smoke checks.

## Trusted Task-completion authority

Persisted `completion_validation` values are claims. They do not independently authorize completion. Every Task has a Schema-required `completion_contract` field, which may remain `null` before activation.

For every completed Task, the pure validator consumes normalized trusted evidence derived in this exact order:

1. unique first non-complete-to-complete closure;
2. single-parent direct completion subject;
3. subject first-parent authority anchor;
4. anchor-owned completion-authority inventory and unchanged authority blobs;
5. non-null Task contract already present at the anchor and unchanged through subject, closure, and validation Head;
6. contract satisfaction through the authority-anchor-to-subject first-parent delta and subject tree;
7. validator-owned canonical subject profile;
8. successful canonical exact-SHA authority-anchor run;
9. successful canonical exact-SHA subject run.

The authority inventory includes the Prompt Quality core, evidence adapter, validator, CLI entrypoint, focused self-test, active v2 Schema, `package.json`, and canonical workflow. A completing subject may not change any listed path. A legitimate authority revision or Task-contract activation must occur in an earlier separate non-completion commit and pass canonical exact-SHA CI before a later subject relies on it.

A non-null `completion_contract` contains exactly:

```text
contract_id
contract_version
task_id
required_changed_paths
required_artifact_paths
required_validation_script_ids
forbidden_changed_paths
```

Required changed paths must appear in the first-parent subject delta; required artifacts must exist as regular files in the subject tree; required validation script IDs must be bindings verified by `peac-canonical-ci.v1`; forbidden paths must not change. Contract evidence present only in another Merge parent is insufficient. An unrelated successful repository change cannot complete a Task.

`completion_validation` contains exactly `validation_status`, `tested_commit`, `source`, `validation_profile`, and `ci_run_reference`. No free-form commands field is authoritative or supported. Local execution may support development reporting but cannot unlock dependent Tasks.

Missing anchor, authority drift, missing or mutated contract, unsatisfied predicates, invalid profile, unavailable exact-SHA run, wrong repository/workflow/job/SHA, or later Task/contract drift fails closed with stable `PQG_COMPLETION_*` diagnostics.

No raw GitHub payload is persisted as authority. No receipt, replay, lifecycle, owner-identity, immutable-Scope, or hash-chain model is reintroduced.

## Invalid-root boundary

`validateProgram(...)` and `validateStatus(...)` reject `null`, arrays, strings, numbers, booleans, and every other non-object program root before `taskMap(...)` or property access.

The guard returns `PQG_SCHEMA_INVALID`; it does not swallow exceptions or weaken required-property enforcement.

`completion_contract` and `completion_validation` remain required on every Task. `last_completed_task` remains required in the bounded status object. Loose-null behavior is not used to accept missing fields.

## Risk-based Scope and review

Routine low-risk changes require:

- a clear PR summary;
- changed-file review;
- canonical CI;
- ordinary review.

High-risk or cross-cutting changes require:

- explicit scope and risk;
- rollback or recovery notes;
- independent review;
- path-sensitive checks where useful;
- canonical CI.

High-risk areas include workflows, public schemas, authentication or authorization, security controls, dependency upgrades, destructive migrations, production routing, release authority, secret handling, and repository permissions.

## Historical v1 model

The v1 program, Scope, lifecycle, evidence, impact, schema, diagnostic, and related files remain preserved for audit history.

They are not active completion authorities. Normal work must not create new v1 receipts, raw GitHub payload copies, lifecycle events, impact entries, immutable Scope amendments, reconciliation carriers, owner-Merge locks, or governance hash chains.

## Approved architecture

### A. Quality-first hybrid evaluation

Repository artifacts remain authoritative for quality definitions, rules, corpora, thresholds, migration readiness, production routing, Task completion, and release approval. External harnesses may execute models and return raw evidence only.

### B. Domain contracts

Future domain contracts are JSON Schema-first, with schema-valid YAML or JSON instances. They separate required, optional, conditional, forbidden, clarification, default, trust-boundary, output-obligation, and risk-trigger semantics. Critical inputs may not receive silent defaults.

### C. Executable rules

Future rules define applicability, carriers, validators, mutation tests, diagnostics, and gates. Prose presence alone is not enforcement.

### D. Thin templates

Templates remain presentation and ordering mechanisms. They do not own domain inputs, behavioral rules, migration state, or quality decisions.

### E. Domain quality packs

Each future pack owns or references its quality policy, contract, rules, templates, corpora, mutations, justified metamorphic relations, model support profile, rubric, and evidence. Development, release, and regression are default corpus layers. Calibration is required before semantic evaluation can become blocking.

### F. Risk-tiered evaluation

Risk derives from `domain.subtype + consumer_path + execution_profile`. The registered future tiers are `Tier_1_Basic`, `Tier_2_Standard`, `Tier_3_High_Risk`, and `Tier_4_Critical`.

### G. Model capability profiles

A model name is not a tested execution identity. Future support is domain-specific, profile-versioned, and conformance-derived.

### H. Semantic evaluation

Semantic evaluation begins non-authoritative and non-blocking. Blocking use requires versioning, schema-valid results, defect-specific rubrics, human-labelled calibration, false-pass measurement, order-bias controls, disagreement handling, and calibration across materially different domains. Failure to evaluate never yields PASS.

### I. Selective shadow

Universal shadow execution is prohibited. Shadow is authorized only from evidence of material risk, weak observability, rollback need, or sensitive automated consumption.

### J. Migration authority

Exactly one path may be production-authoritative. `Migration Promotion Gate` is the sole transition authority; `Quality Delta Gate` is a required subgate.

### K. Complexity budgets

No universal Prompt IR is authorized. Generic semantic containers, arbitrary metadata blobs, unbounded nesting, prompt graphs, role hierarchies, and reasoning-plan trees are prohibited.

### L. Repository Implementation Assurance Lite

`Repository Implementation Assurance Lite` is a cross-cutting adaptive profile, not a new domain and not a target-repository enforcement platform. It is selected only for repository-modification consumer paths when risk tier or task complexity justifies the overhead.

The future bundle is bounded to:

```text
implementation-prompt.md
+
assurance-lite.yaml
```

Prompt-Pipeline validation is structural only. Downstream independent review remains the responsibility of `PR-Inspector`. Assurance Lite begins non-authoritative and non-blocking and is promoted only from measured held-out benefit.

## Registered Task sequence

The exact titles, purposes, dependencies, states, completion contracts, and completion claims for `PPQR-001` through `PPQR-015` are normative in the v2 program.

Eligibility is derived from both the declared dependency graph and authoritative completion evidence. A dependency with `state: complete` remains blocking unless its preactivated Task contract, authority anchor, exact-SHA runs, and all other trusted evidence pass.

Immediately after activation, all fifteen `completion_contract` values are `null`, all Task states are `not_started`, only `PPQR-001` is eligible, and `PPQR-002` through `PPQR-015` are dependency-blocked.
