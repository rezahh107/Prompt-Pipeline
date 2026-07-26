# Prompt Quality and Migration Execution Plan

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

## Trusted Task-completion evidence

Persisted `completion_validation` values are claims. They do not independently authorize completion.

The pure v2 validator consumes a normalized trusted context. The GitHub/Git adapter is separate and supplies that context only from live repository facts.

For every Task whose state is `complete`, authoritative evidence must prove:

1. the claim source is `github_actions`, not local-only;
2. the tested commit exists in `rezahh107/Prompt-Pipeline`;
3. the tested commit is the current validation Head or its ancestor;
4. the referenced run belongs to this repository;
5. the run uses the allowed `CI` workflow;
6. the run completed successfully;
7. the run Head SHA equals the claimed tested commit;
8. the canonical `PEaC canonical exact-head CI` job completed successfully.

Missing, malformed, inaccessible, failed, cancelled, queued, stale, wrong-repository, wrong-workflow, wrong-job, or wrong-SHA evidence fails closed with stable `PQG_*` diagnostics.

Local execution may support development reporting but cannot unlock dependent Tasks. Historical exact-SHA completion remains valid on descendant Heads; current Head equality is not required for every historical completion.

No raw GitHub payload is persisted as authority. No receipt, replay, lifecycle, owner-identity, or hash-chain model is reintroduced.

## Invalid-root boundary

`validateProgram(...)` and `validateStatus(...)` reject `null`, arrays, strings, numbers, booleans, and every other non-object program root before `taskMap(...)` or property access.

The guard returns `PQG_SCHEMA_INVALID`; it does not swallow exceptions or weaken required-property enforcement.

`completion_validation` remains required on every Task. `last_completed_task` remains required in the bounded status object. Loose-null behavior is not used to accept missing fields.

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

The exact titles, purposes, dependencies, states, and completion claims for `PPQR-001` through `PPQR-015` are normative in the v2 program.

Eligibility is derived from both the declared dependency graph and authoritative completion evidence. A dependency with `state: complete` remains blocking unless its trusted completion evidence passes.

Immediately after activation, only `PPQR-001` is eligible. `PPQR-002` through `PPQR-015` are dependency-blocked.
