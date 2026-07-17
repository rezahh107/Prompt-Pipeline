# @rezahh107/pr-inspector-prompt-renderer

## Lifecycle

This package is a **private historical compatibility sentinel** for the retired `PR-Inspector v1.11.0` projection renderer.

It is not an active renderer, an official-output adapter, or a downstream integration for `PR-Inspector v1.11.1`.

- architecture: `historical_fail_closed_compatibility`
- active renderer: `DISABLED`
- publication status: `NOT_PUBLISHED`
- downstream integration status: `NOT_INTEGRATED`
- active Inspector: `rezahh107/PR-Inspector@80bc105d924d7c7dd566e76a9d8d919368655cfa`
- active protocol: `v1.11.1`

## Active output boundary

Prompt-required owner output for the active protocol must be produced inside `PR-Inspector` through the official chain:

```text
review-package.json
→ official decision projection
→ official derived outputs
→ complete validation
→ VerifiedReviewCompletion
→ official_owner_delivery
```

The package does not implement, serialize, copy, reconstruct, normalize, supplement, or imitate `VerifiedReviewCompletion` or `official_owner_delivery`.

No supported cross-repository official-byte interface exists at the pinned active Inspector commit. Therefore active rendering and byte pass-through both fail closed with:

```text
PR_INSPECTOR_V1_11_1_OFFICIAL_OUTPUT_REQUIRED
```

## Public API

The package root exposes only lifecycle/provenance diagnostics and `rejectActiveRendering()`.

The retired `render()`, projection validation, active route tables, schema subpath, and CLI bin are not public exports. The internal legacy `render()` regression hook always throws the deterministic migration error and cannot return prompt bytes.

Historical `v1.11.0` schemas and compatibility snapshots are retained only as non-authoritative diagnostic assets. They cannot masquerade as active compatibility.

## Authority limits

This package never chooses technical status or actions, grants modification authority, satisfies human or specialist review, mints verified completion, reconstructs owner delivery, authorizes merge, claims repository-settings enforcement, publishes itself, or claims downstream integration.
