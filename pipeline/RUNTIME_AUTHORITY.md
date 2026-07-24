# Lean Canonical Generation Spine

The authoritative generation path is:

```text
CLI / API request
→ Canonical Intake
→ ValidatedIntakeEnvelope
→ deriveRuntimeAssessment (single deterministic SSOT)
→ Runtime-derived Route + tri-state Risk + Domain risk rules
→ resolved Contract + executable Policy/Rule carriers
→ staged legacy Template renderer
→ exact per-Check validator execution
→ aggregate compatibility projection derived from per-Check records
→ deterministic authority reducer
→ atomic authority-state publication
→ semantic + integrity verification through the same derivation engine
```

## Authority boundaries

- `src/runtime-authority-api.ts` is the sole public review-transition authority and the official Runtime API surface.
- `src/runtime-authority.ts` owns canonical intake, deterministic derivation, Check execution, authority reduction, generation, publication, and verification. It does **not** export an alternate `reviewArtifact()` function.
- `scripts/peac-generate.ts`, `scripts/peac-review-artifact.ts`, and `scripts/peac-verify-artifact.ts` are thin CLI facades over the official API.
- `src/peac.ts#generateArtifact` remains an internal compatibility renderer. The authoritative Runtime invokes it only in isolated staging and replaces its risk/review/validation projections with canonical Runtime outputs. Its direct output is non-authoritative.
- `--case` is always `fixture_validation`; it publishes only under `outputs/fixtures/` with `downstream_use_allowed: false`.

## Deterministic semantic authority

`deriveRuntimeAssessment(...)` is the one source of truth used by both generation and verification. The verifier reconstructs canonical intake and reruns Route, Risk, Contract, Policy, Rule, required-Check, per-Check validation, checkout, and authority reduction. Serialized derived fields are comparison targets only; they cannot override recomputation.

Integrity and semantic verification are separate dimensions. SHA-256 values prove byte equality, while canonical recomputation proves that the serialized decision matches current Runtime rules. `verified` requires valid integrity, valid semantic derivation, consistent authority, and any required review transition.

## Exact Check set and per-Check validation

The Runtime deterministically derives the complete Check set from core Runtime checks, Domain validators, applicable Policy/Rule carriers, governing sources, checkout provenance, and review eligibility. Verification rejects missing, unknown, duplicate, incorrectly applicable, incorrectly executed, or result-mismatched Checks even when all ordinary hashes are recomputed.

Each applicable Domain validator executes independently and produces its own `ValidationCheckRecord`. A non-applicable Check is always `executed: false` and `passed: null`. Legacy aggregate validation is generated only from those individual records; it is not an authority source.

## Risk and routing semantics

Consequential factors are tri-state: `present`, `absent`, or `unknown`.

- Caller `true` may establish or increase risk.
- Caller `false` is recorded as a claim but cannot independently prove absence.
- Missing fields remain unknown unless positive Runtime evidence resolves them.
- Explicit benign-resolution rules preserve deterministic low-risk authorization for clearly benign requests.
- `domain_hint` is routing evidence only. A conflict with strong Runtime routing evidence produces clarification/review rather than allowing a lower-risk route.
- Domain `route.yaml` risk overrides are compiled into the same canonical risk assessment.

Authority-relevant intake fields are consumed by canonical derivation: `requested_actions`, `consumer_path`, `model_interaction_mode`, `available_sources`, `requires_current_information`, `uses_external_tools`, `external_files`, and `potential_downstream_execution`. No such field silently implies authority while being ignored.

## Authority states

| State | Directory | Downstream use |
|---|---|---:|
| `authorized` | `outputs/authorized/` | true |
| `review_pending` | `outputs/review-pending/` | false |
| `rejected` | `outputs/rejected/` | false |
| `non_authoritative_fixture` | `outputs/fixtures/` | false |

The deterministic reducer orders fixture handling, blocking Check failures, checkout identity, receipt validity/binding, review requirements, and automatic low-risk authorization. An approved owner receipt can authorize only an exact Artifact that recomputes to `review_pending`. A rejected receipt produces `rejected`. Receipt age alone does not invalidate it; payload or semantic drift does.

## Commands

```bash
pnpm peac:generate -- --request path/to/intake.yaml
pnpm peac:generate -- --case domains/general/cases/basic.yaml --mode ci
pnpm peac:verify-artifact -- --artifact outputs/authorized/<artifact>.yaml
pnpm peac:review-artifact -- --artifact outputs/review-pending/<artifact>.yaml --decision approved
pnpm peac:runtime-authority-test
pnpm peac:runtime-cli-help
```

## Assurance terminology

The legacy intake label `production-grade` remains compatible, but its exact Runtime meaning is `static_production_profile`: static Prompt, metadata, Contract, Policy, Rule, and validation checks only. It does not claim target-model execution, behavioral success, semantic correctness, or absence of failure modes.

## Separate governance verifier

`peac:verify-artifact` verifies Runtime Artifact integrity, semantic derivation, and authorization. Prompt Quality governance and PR/lifecycle Evidence verification remain separate and unchanged.

The `PR-Inspector v1.11.1 official-output boundary` CI job uses a repository-local snapshot of four exact source blobs from private repository commit `80bc105d924d7c7dd566e76a9d8d919368655cfa`. CI recomputes each Git blob SHA before running the existing consumer-source verifier. No cross-repository secret, permission, or settings change is required.
