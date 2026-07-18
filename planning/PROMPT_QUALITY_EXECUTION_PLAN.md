# Prompt Quality and Migration Execution Plan

## Authority boundary

This document is the durable human-readable execution-plan authority. It does not carry mutable task state.

Normative machine-readable authority:

`planning/prompt-quality/prompt-quality-execution-program.v1.json`

Mutable current status authority:

`planning/NEXT_WORK.md`

## Activation effect

The activation registers and authorizes the fifteen `PPQR` tasks. It implements governance infrastructure only. It does not implement any substantive Prompt Quality or Migration deliverable, change production routing, improve a quality score, promote a migration, retire a legacy path, integrate Promptfoo, execute a model, or add a semantic judge.

## Approved architecture

### A. Quality-first hybrid evaluation
Repository artifacts remain authoritative for quality definitions, rules, corpora, thresholds, migration readiness, production routing, task completion, and release approval. External harnesses may execute models and return raw evidence only. `promptfoo` is the preferred future execution-only adapter when a task supplies evidence and pins its version.

### B. Domain contracts
Future domain contracts are JSON Schema-first, with schema-valid YAML or JSON instances. They must separate required, optional, conditional, forbidden, clarification, default, trust-boundary, output-obligation, and risk-trigger semantics. Critical inputs may not receive silent defaults.

### C. Executable rules
Future rules must define applicability, carriers, consumption receipts, validators, mutation tests, diagnostics, and gates. Prose presence alone is not enforcement.

### D. Thin templates
Templates remain presentation and ordering mechanisms. They do not own domain inputs, behavioral rules, migration state, or quality decisions. Existing template technology is preserved unless later repository evidence authorizes replacement.

### E. Domain quality packs
Each future pack owns or references its quality policy, contract, rules, templates, corpora, mutations, justified metamorphic relations, model support profile, rubric, and evidence receipts. Development, release, and regression are default corpus layers. Calibration is required before semantic evaluation can become blocking.

### F. Risk-tiered evaluation
Risk derives from `domain.subtype + consumer_path + execution_profile`. The registered future tiers are `Tier_1_Basic`, `Tier_2_Standard`, `Tier_3_High_Risk`, and `Tier_4_Critical`.

### G. Model capability profiles
A model name is not a tested execution identity. Future support is domain-specific, profile-versioned, and conformance-derived.

### H. Semantic evaluation
Semantic evaluation begins non-authoritative and non-blocking. Blocking use requires versioning, schema-valid results, defect-specific rubrics, human-labelled calibration, false-pass measurement, order-bias controls, disagreement handling, and calibration across at least two materially different domains. Failure to evaluate never yields PASS.

### I. Selective shadow
Universal shadow execution is prohibited. Shadow is authorized only from evidence of material risk, weak observability, rollback need, or sensitive automated consumption.

### J. Migration authority
Exactly one path may be production-authoritative. `Migration Promotion Gate` is the sole transition authority; `Quality Delta Gate` is a required subgate. Low-risk and high-risk lifecycle paths remain distinct, and `new_only` requires retirement evidence.

### K. Complexity budgets
No universal Prompt IR is authorized. Generic semantic containers, arbitrary metadata blobs, unbounded nesting, prompt graphs, role hierarchies, and reasoning-plan trees are prohibited.

## Registered task sequence

The exact titles, purposes, dependencies, and state dimensions for `PPQR-001` through `PPQR-015` are normative in the machine-readable program. Eligibility is validator-derived. Immediately after activation, only `PPQR-001` is eligible; all other tasks are dependency-blocked.

## Evidence and lifecycle

- Scope authority: current selector plus immutable scope revisions under `planning/prompt-quality/scopes/`
- Append-only impact chronology: `planning/prompt-quality/impacts/`
- Lifecycle evidence authority: `planning/prompt-quality/lifecycle/PROMPT-QUALITY-PROGRAM-ACTIVATION.ledger.json`
- Stable diagnostics: `planning/prompt-quality/diagnostics/prompt-quality-diagnostics.v1.json`
- Deterministic validator: `scripts/peac-prompt-quality-governance.mjs`

A branch implementation may be implemented and exact-head validated while lifecycle completion remains pending owner merge and exact-main verification.
