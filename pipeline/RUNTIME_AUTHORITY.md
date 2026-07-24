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
→ atomic authority-state publication
→ verifyArtifact(...)
→ reviewArtifact(...) when the verified canonical completion is review_pending
```

## Type-state boundary

`RuntimePlanAssessment` contains routing, closed-world risk, Contract resolution, Policy and Rule carriers, context, `generation-plan.v2`, required Check definitions and governing sources. It contains no validation ledger, authority decision, review receipt or downstream-use state.

`CompletedRuntimeAssessment` can be constructed only after a rendered Prompt, checkout identity, integrity inputs and the exact canonical Check set exist. Its validation ledger is represented as a non-empty tuple. Completion fails when the rendered Prompt is empty, the required Check set is empty, the ledger is empty, a Check is missing, unexpected or duplicated, or canonical applicability/execution/result semantics are violated.

The authority reducer is internal to completion. It is not exported by `src/runtime-authority.ts` or `src/runtime-authority-api.ts`. Official authority operations are generation, verification and review.

## Closed-world Low risk

Automatic Low authorization is limited to explicit benign operations:

- short greeting;
- birthday or congratulation message;
- grammar correction of provided text;
- rewrite of provided text;
- summary of provided text;
- non-operational name brainstorming;
- non-instructional creative poem.

One benign substring is insufficient. Runtime builds one canonical risk surface from the request, desired output, constraints, requested actions, consumer path, model interaction mode, available sources and target environment. Low is available only when one supported benign operation completely covers the intent and no secondary action, unresolved clause or consequential signal remains.

Caller `true` may establish or increase risk. Caller `false` is a claim only and establishes absence solely after complete closed-world benign resolution. Mixed or unresolved intent becomes `unknown` or `clarification_required` and requires review.

## Canonical derived projection

Every authority-relevant persisted derived field is produced by exactly one function:

```text
buildCanonicalDerivedProjection(completed)
```

The projection contains the generation plan, non-empty validation ledger, compatibility validation, routing, risk, legacy risk/review fields, assurance, context attribution, Domain/subtype, canonical provenance, applied Policies, governing sources and source hashes.

Generation serializes this projection and derives all legacy compatibility fields from it. Verification reconstructs a canonical completed assessment, rebuilds the complete projection and compares the whole canonical value. Extra, missing or altered derived fields are rejected even when ordinary hashes, the Artifact SHA and Envelope SHA are recomputed.

New Runtime Artifacts require:

```text
plan_id = peac.validated-generation-plan
plan_version = generation-plan.v2
```

## Validation layers

1. **JSON Schema** validates required fields, types, enums, closed object shapes, receipt shape, non-applicable Check semantics and structural authority/downstream compatibility.
2. **Canonical semantic recalculation** reconstructs Route, Risk, Contract, Policies, Rules, exact Check set, per-Check results, the full Derived Projection and authority state.
3. **Cross-field invariants** ensure authorized states have a completed non-empty passing ledger, review-pending states are not downstream-usable and carry no receipt, reviewed authorization has an exact approved Artifact-bound receipt, and legacy compatibility fields equal canonical projections.

## Review authority

`src/runtime-authority-api.ts#reviewArtifact(...)` is the only public review transition. It consumes an internal verified canonical completion returned by verification; it does not independently trust persisted plan, risk, ledger or checkout fields. Automatic Low Artifacts, rejected Artifacts and insufficient-evidence Artifacts cannot receive review receipts.

Receipts remain exact whole-Artifact SHA-256 bindings. Time passage alone does not invalidate a receipt.

## Compatibility renderer

`src/peac.ts#generateArtifact` remains an internal deterministic Template renderer. The official Runtime invokes it only in an isolated staging workspace. It does not issue canonical Risk, validation, review state or authority.

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

This Runtime provides functional authority consistency for supported interfaces. It does not add cryptographic signing, HMAC, RBAC, secret capabilities, external authorization services, operating-system anti-tamper controls, hostile-owner protections, AIGOV conformance or target-model behavioral assurance.
