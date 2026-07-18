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

### L. Repository Implementation Assurance Lite
`Repository Implementation Assurance Lite` is a cross-cutting adaptive profile, not a new domain and not a target-repository enforcement platform. It is selected only for repository-modification consumer paths when risk tier or task complexity justifies the overhead. Simple repository requests retain the lightweight default path.

The future bundle shape is intentionally bounded:

```text
implementation-prompt.md
+
assurance-lite.yaml
```

The single linked `assurance-lite.yaml` artifact contains:

- atomic requirements and completion conditions;
- risks and failure scenarios;
- acceptance and evidence mappings;
- an implementation-report contract requiring requirement status, changed files, tests, evidence, and residual risks.

Prompt-Pipeline validation is structural only. It checks schema validity, unique identifiers, complete cross-references, requirement-to-acceptance mappings, High/Critical risk-to-mitigation-and-verification mappings, and forbidden lifecycle claims. It does not resolve target-repository files, execute target commands, prove semantic correctness, or claim implementation completion.

The implementation prompt must explicitly consume the linked artifact and must not treat artifact receipt as implementation proof. Downstream independent review remains the responsibility of `PR-Inspector`. A target-repository validator is not required for the initial pilot.

Assurance Lite begins non-authoritative and non-blocking. Promotion requires held-out evidence showing fewer first-review Critical/High findings or fewer repair/rereview cycles after accounting for token, execution, review, and cycle-time overhead. No benefit, material cross-domain leakage, or disproportionate complexity blocks promotion.

## Registered task sequence

The exact titles, purposes, dependencies, and state dimensions for `PPQR-001` through `PPQR-015` are normative in the machine-readable program. Eligibility is validator-derived. Immediately after activation, only `PPQR-001` is eligible; all other tasks are dependency-blocked.

`Repository Implementation Assurance Lite` is implemented incrementally through the existing task sequence rather than through a sixteenth task: baseline measurement in `PPQR-001`, adaptive routing in `PPQR-002`, contract and rule semantics in `PPQR-003` and `PPQR-004`, linked rendering in `PPQR-005`, pilot coverage in `PPQR-006`, bounded structural validation in `PPQR-007`, risk-tier activation in `PPQR-009`, Quality Delta decision in `PPQR-010`, cross-domain containment in `PPQR-012`, and fallback protection in `PPQR-015`.

## Evidence and lifecycle

- Scope authority: current selector plus immutable scope revisions under `planning/prompt-quality/scopes/`
- Append-only impact chronology: `planning/prompt-quality/impacts/`
- Lifecycle evidence authority: `planning/prompt-quality/lifecycle/PROMPT-QUALITY-PROGRAM-ACTIVATION.ledger.json`
- Stable diagnostics: `planning/prompt-quality/diagnostics/prompt-quality-diagnostics.v1.json`
- Deterministic validator: `scripts/peac-prompt-quality-governance.mjs`

A branch implementation may be implemented and exact-head validated while lifecycle completion remains pending owner merge and exact-main verification.
