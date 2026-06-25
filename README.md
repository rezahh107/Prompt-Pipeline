# Prompt Pipeline

Prompt Engineering as Code (PEaC) pipeline for producing versioned, auditable, validated prompt artifacts.

## Current status

Phase 1 scaffolding focuses on the PEaC core plus four starter domains:

- `general`
- `prompt_audit`
- `prompt_refactor`
- `image`

The image domain is included as the first fully worked example, but the repository is intentionally domain-agnostic.

## Workflow

This repository follows a protected-main workflow:

1. Keep `main` stable.
2. Develop on feature branches.
3. Open pull requests for review.
4. Run static validation before merge.
5. Treat generated prompt artifacts as build outputs, not source of truth.

## Quick start

```bash
pnpm install

# Generate from a case file
pnpm peac:generate -- --case domains/image/cases/academic-portrait.yaml --mode batch

# Validate all cases
pnpm peac:validate

# Check KB/rule drift
pnpm peac:sync -- --check
```

## Repository layout

```text
kb/                 Human-readable PEaC knowledge base with stable rule anchors
policies/           Global non-overridable policies
domains/            Domain modules: contracts, rules, templates, validators, cases
pipeline/           Pipeline manifest, routing, execution modes, artifact schema
scripts/            CLI entrypoints
src/                TypeScript implementation
outputs/            Generated artifacts; ignored by Git except .gitkeep
tests/              Static/golden/promptfoo placeholders
```

## Design principle

```text
KB -> Policies/Rules -> Domain Contract -> Template -> Static Validation -> Artifact
```

The language model should not receive the full KB as raw context by default. It should receive the rendered prompt artifact produced by the pipeline.
