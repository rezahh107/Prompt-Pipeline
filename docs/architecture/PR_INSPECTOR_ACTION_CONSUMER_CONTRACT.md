# PR-Inspector Action Compatibility Boundary

## Identity

- Package: `@rezahh107/pr-inspector-prompt-renderer@0.2.0`
- Selected architecture: `historical_fail_closed_compatibility`
- Historical protocol snapshot: `PR-Inspector v1.11.0`
- Active consumer protocol: `PR-Inspector v1.11.1`
- Active consumer identity: `rezahh107/PR-Inspector@80bc105d924d7c7dd566e76a9d8d919368655cfa`
- Lifecycle route identity: `pr_inspector_action.historical.v1`
- Legacy snapshot route contract: `pr_inspector_action.v2`
- Legacy input schema identity: `pr_inspector_action.v2.historical_snapshot`
- Legacy output schema identity: `pr_inspector_action_output.v2.historical_snapshot`
- Publication status: `NOT_PUBLISHED`
- Downstream integration status: `NOT_INTEGRATED`

## Decision

The previous JavaScript renderer is not a supported active consumer for `v1.11.1`.

At the pinned Inspector commit, active owner-facing output requires a genuine in-process Python `VerifiedReviewCompletion` that is reverified by `official_owner_delivery`. The repository does not define a verifiable serialized capability or cross-repository official-byte transport that this JavaScript package can safely accept.

Consequently, this package does not implement an `official-byte adapter`. It fails closed instead.

## Official active chain

```text
review-package.json
→ official decision projection
→ official derived outputs
→ complete validation
→ VerifiedReviewCompletion
→ official_owner_delivery
```

Only the output returned by that chain is authoritative. Projection objects, plain dictionaries, JSON serialization, copied capability-shaped values, compatibility snapshots, templates, or independent JavaScript rendering are not official output sources.

## Public API boundary

The package root exports only:

- active Inspector identity;
- lifecycle metadata;
- historical compatibility metadata;
- build provenance;
- `rejectActiveRendering()`;
- the deterministic migration error type and code.

The package root does not export:

- `render()`;
- `validateInput()` or `validateOutput()`;
- active action routes;
- renderer input/output types;
- a contract/schema subpath;
- a CLI executable bin.

The internal legacy `render()` symbol exists only as a regression target and always throws:

```text
PR_INSPECTOR_V1_11_1_OFFICIAL_OUTPUT_REQUIRED
```

It cannot return authoritative or non-authoritative prompt bytes.

## Historical source isolation

The `v1.11.0` route, schemas, templates, rules, validators, evals, compatibility mappings, and fixtures may remain in the Git repository only as isolated local regression source. They are not an active domain and are never a portable consumer surface.

The exact portable boundary is:

```text
exclude domains/pr_inspector_action/**
```

No tombstone exception is retained. Therefore the complete `domains/pr_inspector_action/` entry list in every generated portable KB ZIP is empty.

The same reconstructive asset set is excluded from:

- npm archives;
- portable KB bundles produced by `pnpm peac:bundle`;
- GitHub Actions `prompt-pipeline-kb-bundle` artifacts;
- project-knowledge exports derived from that bundle;
- generated active prompt artifacts.

The active router contains no `pr_inspector_action` key. `scripts/peac-generate.ts` inspects case-file domain selection before generation and fails with `PR_INSPECTOR_V1_11_1_OFFICIAL_OUTPUT_REQUIRED` when the retired domain is requested. This is an explicit deny boundary, not an inference from missing route files or file extensions.

## Authority separation

This package never:

- selects technical status or action kinds;
- grants modification authority;
- satisfies human or specialist review;
- mints or imitates `VerifiedReviewCompletion`;
- reconstructs `official_owner_delivery`;
- authorizes merge;
- claims repository-settings enforcement;
- publishes itself;
- claims downstream integration.

## Verification

`pnpm peac:bundlecheck` opens the actual generated ZIP central directory and proves that:

- the bundle exists and contains normal knowledge files;
- no `domains/pr_inspector_action/` entry remains;
- no historical template, route, rule, validator, eval, schema, compatibility mapping, or fixture is distributed;
- the active router cannot select the retired domain;
- a real CLI case-file selection attempt exits non-zero with the deterministic migration error.

Existing npm package and workflow-policy tests continue to prove that the package root does not export `render()`, internal `render()` always rejects active rendering, the archive remains private and fail-closed, Actions use immutable full SHAs, checkouts disable credential persistence, workflow permissions are read-only, exact-head identity is asserted, and dependency installation uses the frozen lockfile.

## Supply-chain controls

CI remains exact-head and least-privilege:

- every Action is pinned to a full commit SHA;
- every checkout uses `persist-credentials: false`;
- workflow permissions remain `contents: read`;
- every job asserts `git rev-parse HEAD == TESTED_SHA`;
- every install uses `pnpm install --frozen-lockfile`;
- the active Inspector source is pinned to `80bc105d924d7c7dd566e76a9d8d919368655cfa`;
- CI verifies `CURRENT_VERSION`, `official_review.py`, `owner_delivery.py`, and `CANONICAL_OUTPUT_ENFORCEMENT.md` before package validation.

## Lifecycle

A successful implementation remains:

```text
implemented_pending_rereview
```

It does not close `PRF-011`, authorize merge, establish active integration, or replace a fresh independent PR-Inspector review of the exact resulting head.
