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

The package is a deterministic renderer and consumer-side conformance validator. It consumes an already-authoritative PR-Inspector projection. It derives only the source-pinned expected status and cross-representation relations needed to validate that supplied projection; it does not select reasons or actions, approve, merge, publish, deploy, or verify repository settings.

## Active consumer compatibility

The v2 input consumes the fields required to render or safely reject the operational action artifact:

- exact review identity and canonical action tuple;
- `inspection_profile`;
- separated `technical_decision` and `governance_decision`;
- `overall_recommendation` and `governance_follow_up`;
- `external_review_reconciliation` summary and independently valid linked finding IDs.

The profile, separated decisions, recommendation, governance follow-up, and reconciliation are validated but not converted into new authority. Governance reasons cannot authorize technical repair. `OWNER_PROFILE_COMMANDS.fa.txt`, owner-delivery atomicity, repository-setting verification, merge authorization, publication, and downstream adapter behavior are outside this package boundary.

## Reason authority

`domains/pr_inspector_action/reason-compatibility.v1.11.0.json` is a deterministic compatibility snapshot derived from four pinned active-consumer sources at inspector commit `f0f74bba89e4c85f4a4b10c706a2be2980d71c25`:

- `protocols/v1.11.0/registries/DECISION_REASON_REGISTRY.yaml`;
- `pr_inspector/decision_projection.py`;
- `pr_inspector/decision_projection_core.py`;
- `pr_inspector/constants.py`.

The snapshot records exact Git blob identities, raw SHA-256 values, normalized source-block hashes, all 29 canonical `RSN-*` entries, all 17 candidate-domain entries, the active status mappings, and the exact ordered `_CANDIDATE_REASON_BY_CANONICAL` relation. CI checks out the pinned inspector commit and reproduces the transformation. Runtime rendering remains offline.

Canonical reasons do not carry an invented `decision_domain`. Canonical technical status is validated from every registered canonical reason in registry order using `technical_status_effect`, with Red precedence over Yellow and Yellow over Green. Security-profile reasons therefore affect canonical status exactly as they do in active PR-Inspector.

Every accepted canonical reason must be registered and represented in the complete `reason_details` carrier with its source-defined recovery action. Action compatibility is checked only against the routed `next_action_reason_codes` subset. `repair_and_verify` requires both a registered repair effect and a registered verification effect in that action subset. Unknown, duplicate, absent-from-complete, wrong-action, wrong-recipient, wrong-authority, wrong-prompt-kind, and recovery-action drift fail closed.

## Projection reason-carrier separation

The input preserves the three distinct active `DECISION_PROJECTION.json` reason domains:

- `reason_details`: every complete canonical reason instance, including historical and security-profile reasons;
- `technical_status_reason_codes`: exactly the dominant status-effect subset returned by `_technical_status(all_codes)`;
- `next_action_reason_codes`: exactly the routed action subset returned by `_choose_action(pkg, technical_status, all_codes)`.

Every status or action reason must exist in the complete carrier. Complete reasons may remain outside the selected action subset. For `STALE` or `UNKNOWN`, the action remains `rerun_review` with only `RSN-REVIEW-NOT-CURRENT`; historical High or Critical reasons remain visible in the complete and candidate representations but cannot authorize repair, a repair handoff, or code modification.

## Cross-representation derivation

`technical_decision.status` must equal the active candidate status corresponding to canonical `technical_status`. `technical_decision.reason_codes` must exactly equal the ordered, first-occurrence-deduplicated projection of all complete canonical `reason_details` through the pinned `_CANDIDATE_REASON_BY_CANONICAL` mapping. An extra, missing, substituted, or reordered candidate reason is rejected even when it has the same final color.

A non-Green canonical status may legitimately have an empty candidate reason list when its canonical cause has no active candidate mapping. In particular, a minimal-profile security reason can produce canonical Yellow and candidate Yellow with `reason_codes: []`. This is validated without converting security-profile reasons into governance-only data.

Candidate technical and governance domains remain separate. For `inspection_profile: minimal`, governance must be exactly `NOT_REQUESTED` with no reasons. Strict governance accepts only relations emitted by the pinned implementation; the renderer does not infer repository enforcement or merge authorization.

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
