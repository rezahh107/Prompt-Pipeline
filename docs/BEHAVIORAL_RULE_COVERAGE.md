# Behavioral Rule Coverage

This document defines the lightweight coverage policy for high-risk behavioral rules in the Prompt-Pipeline repository.

## Purpose

Prompt repository rules can influence model behavior, but prose alone is not enforcement. High-risk behavioral rules should have at least one concrete carrier such as a schema field, validator check, rubric check, fixture, CI step, downstream contract, or human-review gate.

This repository uses `pipeline/behavioral-rule-coverage.yaml` as the source of truth for the current coverage map.

## Coverage statuses

- `validator_backed`: the rule is represented by validator or rubric checks.
- `fixture_tested`: the rule has at least one valid or invalid fixture exercising it.
- `ci_enforced_lite`: the rule is checked by the lightweight coverage script in CI.
- `tracked_gap`: the rule is recognized as important, but still needs stronger enforcement in a later patch.

`tracked_gap` is allowed in the Lite phase only when the rule has at least one documented coverage carrier and a concrete `next_hardening` item.

## Minimum rule record

Each behavioral rule record should include:

```yaml
rule_id: R-PP-EXAMPLE-001
title: Short operational title
risk: high
source_refs:
  - path/to/source.yaml#rule-or-gate-id
coverage:
  schema_carriers: []
  validator_rules: []
  rubric_checks: []
  valid_fixtures: []
  invalid_fixtures: []
  ci_steps: []
  downstream_contracts: []
coverage_status: tracked_gap
next_hardening:
  - Add an invalid fixture.
```

## Lite-phase rule

The Lite checker does not prove semantic correctness. It prevents critical/high behavioral rules from being invisible or completely prose-only.

The check fails when:

- `pipeline/behavioral-rule-coverage.yaml` is missing or malformed.
- a rule has no `rule_id`, `title`, `risk`, `source_refs`, `coverage`, or `coverage_status`.
- a referenced file path does not exist.
- a critical/high rule has no coverage carrier.
- a `fixture_tested` rule points to missing fixture files.
- a `tracked_gap` rule has no `next_hardening` item.

## Scope boundary

This is Patch 2 Lite. It does not yet implement full downstream rejection, automated semantic proof, or adversarial fixture execution. Those belong to later patches.
