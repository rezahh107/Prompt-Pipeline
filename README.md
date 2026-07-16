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
- `pr_inspector_action` (explicitly pinned deterministic consumer domain)

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

# Validate the PR-Inspector renderer and public package boundary
pnpm peac:pr-inspector-renderer
pnpm peac:pr-inspector-renderer-pack

# Full local CI
pnpm ci
```

## PR-Inspector action renderer package

`packages/pr-inspector-prompt-renderer` prepares the public package `@rezahh107/pr-inspector-prompt-renderer@0.1.0`. It is an offline deterministic renderer for canonical `PR-Inspector` action data. It does not decide the action, call an LLM, modify repositories, approve, merge, or publish itself.

The authoritative contract, schemas, route map, templates, policies, fixtures, and behavioral coverage live under `domains/pr_inspector_action/`. The package build copies only the allowlisted runtime assets from that domain. See `docs/architecture/PR_INSPECTOR_ACTION_CONSUMER_CONTRACT.md`.

This repository does not publish the package automatically and does not contain an npm token or publication workflow.

## Repository layout

```text
kb/                 Human-readable PEaC knowledge base with stable rule anchors
policies/           Global non-overridable policies
domains/            Domain modules: contracts, rules, templates, validators, cases
packages/           Public-ready bounded runtime packages sourced from authoritative domains
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
