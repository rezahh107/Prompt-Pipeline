# Runtime Authority — Type-State Canonical Generation Spine

The supported Runtime path is:

```text
CLI / API request
→ Canonical Intake
→ ValidatedIntakeEnvelope
→ compileRuntimePlan(...)
→ RuntimePlanAssessment (cannot issue authority)
→ isolated legacy rendering
→ completeRuntimeAssessmentInternal(...)
→ CompletedRuntimeAssessment (non-empty exact ledger + checkout identity)
→ buildCanonicalDerivedProjection(...)
→ Canonical Artifact Base + Canonical Prompt Identity
→ atomic authority-state publication
→ verifyArtifact(...)
→ typed VerificationFacts + precedence reducer
→ reviewArtifact(...) when the verified canonical completion is review_pending
```

## Type-state boundary

`RuntimePlanAssessment` contains routing, operation-aware risk, Contract resolution, Policy and Rule carriers, context, `generation-plan.v2`, required Check definitions and governing sources. It contains no validation ledger, authority decision, review receipt or downstream-use state.

`CompletedRuntimeAssessment` can be constructed only after a rendered Prompt, checkout identity, integrity inputs and the exact canonical Check set exist. Its validation ledger is represented as a non-empty tuple. Completion fails when the rendered Prompt is empty, the required Check set is empty, the ledger is empty, a Check is missing, unexpected or duplicated, or canonical applicability/execution/result semantics are violated.

The authority reducer remains internal to completion. It is not exported by `src/runtime-authority.ts` or `src/runtime-authority-api.ts`. Official authority operations are generation, verification and review.

## Operation-aware exhaustive payload proof

Automatic Low authorization is limited to explicit benign operations:

- short greeting;
- birthday or congratulation message;
- grammar correction of a bounded deterministic literal;
- rewrite request with no embedded payload;
- summary request with no embedded or referenced payload;
- non-operational name brainstorming with no payload or a bounded topic literal;
- non-instructional creative poem with no payload or a bounded topic literal.

Every `BenignOperation` has an exhaustive `BenignOperationPayloadPolicy`. A missing policy is a mechanical inventory failure. Runtime records a `BenignPayloadAssessment` with the payload kind, proof result, payload sources and unresolved reasons.

The assessment covers inline request payload, `desired_output`, constraints, `requested_actions`, `consumer_path`, `model_interaction_mode`, `available_sources`, `context_items`, and authority-relevant `target_environment`. Absence of a consequential Regex match is not payload proof. Free-form or referenced payload defaults to review-required unless it belongs to a bounded deterministic grammar. Caller `false` cannot establish absence while payload proof is incomplete.

Generic no-payload greetings and congratulations remain eligible for Low. Mixed and split-field intent remain review-required.

## Canonical Artifact Base and Prompt identity

Persisted Runtime Artifacts contain:

```text
canonical_base:
  canonicalIntake: <PersistedCanonicalIntake>
  executionContext:
    mode: interactive | batch | ci | agent

canonical_prompt_identity:
  promptId: <canonical identifier>
  domain: <selected domain>
  subtype: <selected subtype or null>
  templatePath: <selected template path or null>
  templateVersion: <selected Contract version>
```

Canonical intake remains solely the normalized user intake; execution mode is not added to it. The canonical intake digest therefore remains identical when the same intake is generated in different execution modes.

`prompt_id` is derived once from the canonical Runtime plan and selected Template identity. `execution_mode` is derived once from `canonical_base.executionContext.mode`. The serialized top-level fields remain compatibility projections and cannot independently establish identity. The isolated legacy renderer's `prompt_id` and `execution_mode` are comparison evidence only and are not authority.

## Canonical derived projection

Every persisted derived authority field remains produced by:

```text
buildCanonicalDerivedProjection(completed)
```

The projection contains the generation plan, non-empty validation ledger, compatibility validation, routing, risk, legacy risk/review fields, assurance, context attribution, Domain/subtype, canonical provenance, applied Policies, governing sources and source hashes.

Generation serializes this projection and derives compatibility fields from canonical values. Verification reconstructs a canonical completed assessment, rebuilds the complete projection and compares the whole canonical value. Extra, missing or altered derived fields are rejected even when ordinary hashes, the Artifact SHA and Envelope SHA are recomputed.

New Runtime Artifacts require:

```text
plan_id = peac.validated-generation-plan
plan_version = generation-plan.v2
```

## Total fail-closed verification

`verifyArtifact(...)` returns a deterministic `VerificationResult` for every parseable malformed input. Nested canonical fields are safely parsed before use. Public `VerificationResult` and `diagnostics: string[]` remain compatible.

Verification records bounded typed facts:

- Schema contradictions;
- integrity contradictions;
- semantic contradictions;
- authority contradictions;
- canonical evidence unavailable.

The reducer applies exact precedence:

```text
any contradiction → rejected
otherwise canonical expected evidence unavailable → insufficient_evidence
otherwise → verified
```

Status is not inferred from diagnostic message text. The canonical Runtime plan determines the expected governing-source inventory. Persisted sources are compared evidence, not the authority for which sources should exist. A source-set mismatch is a semantic contradiction; genuine absence of an otherwise matching canonical expected source is insufficient evidence only when no contradiction exists.

A verified review capability is issued only for a fully verified canonical completion.

## Validation layers

1. **Safe structural parsing and JSON Schema** validate minimum structure, required fields, types, enums, closed object shapes, canonical base/identity, receipt shape, Check semantics and structural authority/downstream compatibility.
2. **Canonical semantic recalculation** reconstructs Route, operation-aware Risk, Contract, Policies, Rules, canonical expected source inventory, exact Check set, per-Check results, Prompt identity, execution context, the full Derived Projection and authority state.
3. **Cross-field invariants** ensure authorized states have a completed non-empty passing ledger, review-pending states are not downstream-usable and carry no receipt, reviewed authorization has an exact approved Artifact-bound receipt, and compatibility fields equal canonical projections.

## Review authority

`src/runtime-authority-api.ts#reviewArtifact(...)` is the only public review transition. It consumes an internal verified canonical completion; it does not independently trust persisted plan, risk, ledger, checkout, Prompt identity or execution mode. Automatic Low Artifacts, rejected Artifacts and insufficient-evidence Artifacts cannot receive review receipts.

Review output filenames use the verified canonical Prompt identity. Receipts remain exact whole-Artifact SHA-256 bindings. Time passage alone does not invalidate a receipt.

## Compatibility renderer

`src/peac.ts#generateArtifact` remains an internal deterministic Template renderer. The official Runtime invokes it only in an isolated staging workspace. It does not issue canonical Risk, validation, identity, review state or authority.

## Authority states

| State | Directory | Downstream use |
|---|---|---:|
| `authorized` | `outputs/authorized/` | true |
| `review_pending` | `outputs/review-pending/` | false |
| `rejected` | `outputs/rejected/` | false |
| `non_authoritative_fixture` | `outputs/fixtures/` | false |

## Commands

```bash
pnpm peac:generate -- --request path/to/intake.yaml
pnpm peac:generate -- --case domains/general/cases/basic.yaml --mode ci
pnpm peac:verify-artifact -- --artifact outputs/authorized/<artifact>.yaml
pnpm peac:review-artifact -- --artifact outputs/review-pending/<artifact>.yaml --decision approved
pnpm peac:runtime-authority-test
```

## Scope boundary

This bounded repair implements G1-M2, G2-M2 and G3-M2 without introducing a shared cross-cutting framework. It preserves the Type-State completion path, canonical Check ledger, Derived Projection, internal authority reducer, single review transition, exact checkout binding and atomic publication.

It does not add cryptographic signing, HMAC, RBAC, authentication, external authorization services, compliance infrastructure, operating-system anti-tamper controls, hostile-owner protections, AIGOV conformance or target-model behavioral assurance.
