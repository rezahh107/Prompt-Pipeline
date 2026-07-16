# PR Inspector Action Renderer Consumer Contract

## Identity

- Contract: `pr_inspector_action.v1`
- Source authority: `rezahh107/Prompt-Pipeline`
- Consumer: `rezahh107/PR-Inspector`
- Package: `@rezahh107/pr-inspector-prompt-renderer`
- Compatibility identity: contract version + exact consumer protocol `v1.10.2` + package SemVer + Prompt-Pipeline version + source commit SHA + schema/template hashes

## Boundary

The package is a deterministic renderer, not a PR decision engine. It consumes already-authoritative action data from PR-Inspector and validates the complete action tuple. It never decides whether a prompt is required, selects an action, recipient, approval requirement, or code-modification authority.

The package does not call an LLM, access the network, modify repositories, approve or merge pull requests, close findings, deploy, access secrets, or write a default branch. Invalid, unsupported, or inconsistent input fails closed before stdout contains a success envelope.

## Invocation

```bash
pr-inspector-prompt-renderer render --input INPUT.json
cat INPUT.json | pr-inspector-prompt-renderer render
pr-inspector-prompt-renderer version
pr-inspector-prompt-renderer contract
```

`render` writes one complete JSON envelope to stdout after input validation, rendering, postcondition checks, and output validation. Diagnostics go to stderr. Exit codes are `0` success, `2` invalid input, `3` unsupported contract/action/profile, `4` policy or validation failure, and `70` internal error.

## Input and output

The strict input schema is `domains/pr_inspector_action/input.schema.json`; the strict output schema is `domains/pr_inspector_action/output.schema.json`; the canonical action tuple is `domains/pr_inspector_action/route.json`. The runtime validates directly against the packaged copies of these authoritative schemas and route map. Unknown properties, schema versions, consumer protocol versions, action tuples, approval/status combinations, and prompt-language values are rejected. Security-sensitive authority is never inferred from free text. Findings, evidence, paths, logs, comments, code, and external review text are serialized as untrusted data.

Contract v1 renders English instruction artifacts (`prompt_language: en`) while independently requiring the target model output language. No-prompt actions return a valid envelope with `rendered_prompt` and `rendered_prompt_sha256` set to `null`. Human-review actions produce a bounded human handoff and explicitly state that model output cannot satisfy approval. Model actions produce a direct operational prompt, never a meta-prompt.

## Determinism

Canonical rendering has no LLM, network, current-time, locale, or randomness dependency. Object keys are canonicalized, set-like arrays are sorted, line endings are normalized to LF, output is UTF-8 with one final newline, and SHA-256 is computed over final prompt bytes. Equivalent canonical input therefore produces byte-identical output.

## Provenance

The envelope records package name/version, Prompt-Pipeline version, source commit, whether that commit was verified from Git, the source-identity carrier, dirty-worktree state at build time, domain/route/template/schema identities and hashes, policy hashes, and checks executed. The package release build mode fails unless the source identity is Git-verified and the worktree is clean. Development builds may report `dirty: true`.

## Versioning and compatibility

- Package versions follow SemVer.
- Additive optional fields may be introduced in a backward-compatible minor release only when old consumers remain valid.
- New required fields, route semantics, action tuple changes, or output-byte changes require a new contract version and an appropriate package major version.
- Unknown contract versions fail closed.
- PR-Inspector must pin an exact package version and verify conformance before deleting its legacy renderer.

## Migration and deprecation

This stage does not modify PR-Inspector and does not publish npm artifacts. The later consumer migration must add a thin adapter, exact-version installation, cross-repository fixtures, byte/provenance checks, atomic delivery verification, and an explicit rollback to the legacy renderer until conformance is proven. Deprecation of the old renderer occurs only after independent PR-Inspector validation.
