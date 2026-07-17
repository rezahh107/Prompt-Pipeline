# Prompt Pipeline

Prompt Engineering as Code (PEaC) pipeline for producing versioned, auditable, validated prompt artifacts.

## Current status

This repository is now designed as both:

1. a theory-grounded prompt engineering knowledge base, and
2. an executable pipeline for generating, validating, evaluating, and bundling prompt artifacts.

Starter and extended domains:

- `general`
- `prompt_generation`
- `prompt_audit`
- `prompt_refactor`
- `document_review`
- `repo_review`
- `coding_debugging`
- `image`
- `multimodal`
- `ai_workflow_design`
- `pr_inspector_action` (historical, non-authoritative compatibility snapshots only)

The image domain remains a worked example, while the newer knowledge-pipeline domains let the repository operate as a reusable prompt production system.

## Workflow

This repository follows a protected-main workflow:

1. Keep `main` stable.
2. Develop on feature branches.
3. Open pull requests for review.
4. Run static validation before merge.
5. Treat generated prompt artifacts and ZIP bundles as build outputs, not source of truth.

## Model / agent usage

When an LLM is pointed at this repository, it should start from:

```text
pipeline/AGENT_ENTRYPOINT.md
```

The model should not consume the full repository as a raw prompt. It should:

1. read the entrypoint,
2. ask for the user's topic/problem if missing,
3. normalize the request with `pipeline/intake.schema.json`,
4. route to the best domain,
5. apply policies and domain rules,
6. render a prompt artifact,
7. report validation and human-review notes.

## Quick start

```bash
pnpm install

# Generate from a case file
pnpm peac:generate -- --case domains/image/cases/academic-portrait.yaml --mode batch

# Generate a production-grade prompt generation artifact
pnpm peac:generate -- --case domains/prompt_generation/cases/master-prompt-basic.yaml --mode batch

# Validate all cases
pnpm peac:validate

# Run rubric checks
pnpm peac:eval

# Check KB/rule drift
pnpm peac:sync -- --check

# Build portable knowledge bundle for project knowledge upload
pnpm peac:bundle

# Validate the PR-Inspector historical fail-closed boundary
pnpm peac:pr-inspector-renderer
pnpm peac:pr-inspector-renderer-pack

# Full local CI
pnpm ci
```

## PR-Inspector compatibility package

`packages/pr-inspector-prompt-renderer` is a private historical compatibility sentinel for the retired `PR-Inspector v1.11.0` projection renderer. It is not an active renderer, a published npm package, or a downstream integration.

The active consumer identity is `rezahh107/PR-Inspector@80bc105d924d7c7dd566e76a9d8d919368655cfa` using protocol `v1.11.1`. Active prompt-required owner output must come from a genuine `VerifiedReviewCompletion` through `official_owner_delivery` inside `PR-Inspector`.

Because the pinned active repository exposes no supported serialized or cross-repository official-byte interface, this package uses `historical_fail_closed_compatibility`. Projection objects, dictionaries, serialized capability lookalikes, and the retired `render()` path all fail with `PR_INSPECTOR_V1_11_1_OFFICIAL_OUTPUT_REQUIRED`.

Historical schemas and compatibility snapshots remain under `domains/pr_inspector_action/` for diagnostics only. Package archives exclude prompt templates and active rendering policy assets. See `docs/architecture/PR_INSPECTOR_ACTION_CONSUMER_CONTRACT.md`.

Publication status is `NOT_PUBLISHED`; downstream integration status is `NOT_INTEGRATED`.

## Repository layout

```text
kb/                 Human-readable PEaC knowledge base with stable rule anchors
policies/           Global non-overridable policies
domains/            Domain modules; PR-Inspector assets are historical snapshots only
packages/           Bounded private compatibility packages and runtime packages
pipeline/           Pipeline manifest, routing, intake, quality gates, artifact schema, bundle manifest
scripts/            CLI entrypoints
src/                TypeScript implementation
evals/              Local rubric checks for generated artifacts
docs/               Master reference, architecture decisions, and hardening notes
outputs/            Generated artifacts; ignored by Git except .gitkeep
dist/               Generated bundles; ignored by Git
```

## Design principle

```text
KB -> Policies/Rules -> Domain Contract -> Template -> Static Validation -> Eval -> Artifact -> Bundle
```

The language model should not receive the full KB as raw context by default. It should receive the rendered prompt artifact produced by the pipeline, or the compiled ZIP bundle when operating inside a project knowledge base.

## Source of truth

```text
Git repository = source of truth
Rendered artifact = task-specific prompt unit
ZIP bundle = portable consumption package
```
