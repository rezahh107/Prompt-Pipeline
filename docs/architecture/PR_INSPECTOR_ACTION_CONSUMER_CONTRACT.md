# PR Inspector Action Renderer Consumer Contract

## Identity

- Active contract: `pr_inspector_action.v2`
- Active output contract: `pr_inspector_action_output.v2`
- Evaluation suite: `pr_inspector_action.v2`
- Active consumer protocol: `PR-Inspector v1.11.0`
- Pinned consumer identity: `rezahh107/PR-Inspector@f0f74bba89e4c85f4a4b10c706a2be2980d71c25`
- Package: `@rezahh107/pr-inspector-prompt-renderer@0.2.0`
- Publication state: `NOT_PUBLISHED`
- Downstream state: `PR_INSPECTOR_NOT_YET_INTEGRATED`

The previous unpublished `pr_inspector_action.v1` / `v1.10.2` boundary is historical. The active package entry point rejects it as unsupported; it cannot masquerade as current compatibility.

## Boundary

The package is a deterministic renderer and consumer-side conformance validator. It consumes an already-authoritative PR-Inspector projection and does not select reasons, recompute status, choose an action, approve, merge, publish, deploy, or verify repository settings.

## Active consumer compatibility

The v2 input consumes the fields required to render or safely reject the operational action artifact:

- exact review identity and canonical action tuple;
- `inspection_profile`;
- separated `technical_decision` and `governance_decision`;
- `overall_recommendation` and `governance_follow_up`;
- `external_review_reconciliation` summary and independently valid linked finding IDs.

The profile, separated decisions, recommendation, governance follow-up, and reconciliation are validated but not converted into new authority. Governance reasons cannot authorize technical repair. `OWNER_PROFILE_COMMANDS.fa.txt`, owner-delivery atomicity, repository-setting verification, merge authorization, publication, and downstream adapter behavior are outside this package boundary.

## Reason authority

`domains/pr_inspector_action/reason-compatibility.v1.11.0.json` is a deterministic compatibility snapshot of the authority-bearing fields from `protocols/v1.11.0/registries/DECISION_REASON_REGISTRY.yaml` at inspector commit `f0f74bba89e4c85f4a4b10c706a2be2980d71c25`.

The snapshot records the raw source SHA-256, Git blob identity, selected-field transformation hash, all 29 canonical `RSN-*` reasons, and all 17 candidate technical/governance reason-domain entries. CI checks out the pinned inspector commit and verifies the raw source and deterministic transformation. Runtime rendering is offline and validates only the packaged snapshot.

Every accepted canonical reason must be registered, have a matching detail record, carry the correct decision domain and recovery action, and be compatible with the supplied action. `repair_and_verify` requires both a registered repair effect and a registered verification effect. Unknown, duplicate, orphan, wrong-domain, wrong-action, wrong-recipient, wrong-authority, wrong-prompt-kind, and recovery-action drift fail closed.

## Exact review identity

`review_validity: CURRENT` requires exact lowercase 40-character `reviewed_head_sha` and `base_sha`. Every current evidence record must carry the same reviewed head. No modifying output can be produced unless the review is CURRENT and both commit identities are exact. STALE and UNKNOWN review routes remain non-modifying.

The output repeats the exact identity in a structured object, records its SHA-256, and verifies that rendered identity text matches the validated input exactly.

## Determinism and trust

Rendering has no LLM, runtime network, current-time, locale, or randomness dependency. Object keys use explicit Unicode/code-unit ordering, set-like arrays are sorted, line endings normalize to LF, and final bytes are hashed. Repository content, findings, evidence, paths, comments, logs, and external review text remain serialized data and cannot create fixed instructions.

## Supply chain

`pnpm-lock.yaml` is committed. Every validation job uses `pnpm install --frozen-lockfile`. Workflow actions are pinned to full commit SHAs, checkout credentials are disabled, permissions remain `contents: read`, and each job asserts `git rev-parse HEAD == TESTED_SHA` before validation.

## Provenance and packaging

Package provenance records source identity, clean/dirty state, contract and schema identities, templates, policy hashes, and both compatibility asset hashes. The actual npm archive is inspected against a strict allowlist and verifies executable CLI metadata. The package remains `UNLICENSED` and must not be published in this stage.

## Lifecycle

A successful implementation remains `implemented_pending_rereview`. It does not close findings, satisfy independent review, authorize merge, or claim downstream integration.
