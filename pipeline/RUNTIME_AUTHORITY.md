# Lean Canonical Generation Spine

The authoritative generation path is:

```text
CLI / API request
→ Canonical Intake
→ ValidatedIntakeEnvelope
→ Runtime-derived Route and Risk
→ ValidatedGenerationPlan
→ Contract + Policy + Domain Rule carriers
→ staged legacy template renderer
→ structured blocking Validation Ledger
→ Artifact-bound owner review when required
→ atomic authority-state publication
→ peac:verify-artifact
```

## Authority boundaries

- `src/runtime-authority-api.ts` is the official Runtime authority API for generation, review, and verification.
- `src/runtime-authority.ts` contains the shared canonical intake, plan, risk, validation, publication, and verification implementation used by that API.
- `scripts/peac-generate.ts`, `scripts/peac-review-artifact.ts`, and `scripts/peac-verify-artifact.ts` are thin CLI facades over the official API.
- `src/peac.ts#generateArtifact` remains an internal compatibility renderer for repository fixtures and existing deterministic validation suites. It is invoked only inside an isolated staging workspace by the authoritative Runtime. Its direct output is not an authorized Runtime Artifact.
- `--case` is always `fixture_validation`; it publishes only under `outputs/fixtures/` with `downstream_use_allowed: false`.

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

## Risk and trust semantics

Caller Boolean fields are evidence hints, not final authority. Missing consequential risk evidence remains `unknown`; unmatched high-stakes requests do not become low risk. A high or unknown consequential result requires review, and a forced `general` route above `general.max_risk_level` cannot be automatically authorized.

Caller labels such as `official` and `trusted` become `manual_attributed` unless Runtime-verifiable source evidence establishes `source_bound`.

## Assurance terminology

The legacy intake label `production-grade` is retained for compatibility, but its exact Runtime meaning is `static_production_profile`: static Prompt, metadata, contract, Policy, Rule, and validation checks only. It does not claim target-model execution, behavioral success, semantic correctness, or absence of failure modes.

## Separate governance verifier

`peac:verify-artifact` verifies Runtime Artifact integrity and authorization. Existing Prompt Quality governance and PR/lifecycle Evidence verification remain separate and unchanged.
