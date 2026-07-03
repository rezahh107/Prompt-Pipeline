---
title: "Behavioral Rule Coverage"
version: "2026.3"
status: "canonical"
---

# Behavioral Rule Coverage

<!-- peac-rule-id: coverage.critical_rules_not_prose_only -->
Critical and high-risk behavioral gates should not remain prose-only when the deployment supports stronger carriers. If a system is prompt-only, mark the gap honestly and prefer external validation for production use.
<!-- /peac-rule-id -->

## Purpose

This module tracks whether behavioral rules have moved from prose into checkable carriers.

## Coverage row format

```yaml
rule_id: R-EXAMPLE-001
concept: "Human review is required before destructive actions."
risk: critical
scope: prompt_pipeline|domain|deployment
claim_type: engineering_heuristic|provider_documented|research_supported|project_specific
prose_source: kb/...#anchor
prompt_level_carrier: template instruction
schema_carrier: pipeline/artifact.schema.json field
validator_rule: domains/<domain>/validators.yaml check id
valid_fixture: domains/<domain>/cases/valid.yaml
invalid_fixture: domains/<domain>/cases/invalid.yaml
ci_step: pnpm ci
downstream_contract: "Consumer rejects missing review gate."
status: prompt_level_influence|validator_backed|ci_enforced|downstream_contract_enforced
```

## Risk levels

| Risk | Meaning | Minimum expectation |
|---|---|---|
| critical | Ignoring the rule may cause unsafe action, security boundary failure, false readiness, irreversible rework, or serious trust loss. | Validator/fixture/CI where available; otherwise explicit human review gate. |
| high | Ignoring the rule may cause significant ambiguity, unsupported claims, rework, or invalid downstream package. | At least prompt-level plus static validation where practical. |
| medium | Quality or clarity issue. | Template or prose may be acceptable. |
| low | Style or presentation preference. | Prose is usually enough. |

## Audit method

Search for imperative language:

```text
must, must not, never, always, only, required, forbidden
باید، نباید، هرگز، همیشه، فقط، الزامی است، مجاز نیست
```

Then ask:

1. What failure happens if the rule is ignored?
2. Is the rule critical/high?
3. What carries it besides prose?
4. Is there a failing case?
5. Does CI or downstream logic reject the failure?

## Anti-overengineering guard

Do not create validators for every style preference. Enforce the smallest rule that blocks the real failure mode.
