---
title: "Structured Outputs and Schema-Guided Prompts"
version: "2026.3"
status: "canonical"
---

# Structured Outputs and Schema-Guided Prompts

<!-- peac-rule-id: structured_outputs.schema_not_semantics -->
A schema can constrain output shape, but it does not by itself prove factual correctness, source quality, semantic fidelity, or safe downstream use.
<!-- /peac-rule-id -->

## Use structured outputs when

- downstream automation will parse the result
- the result becomes an input to another agent or validator
- the task requires traceable fields such as assumptions, evidence, risks, or open questions
- invalid output should fail closed

## Minimum fields for serious prompt artifacts

```yaml
objective: string
inputs_required: string[]
constraints: string[]
evidence_policy: string
output_contract: object
risk_level: low|medium|high
human_review_required: boolean
validation_checks: string[]
```

## Failure modes

| Failure | Meaning | Mitigation |
|---|---|---|
| shallow compliance | JSON is valid but semantically empty | minimum semantic children |
| fabricated evidence | source fields contain invented citations | source verification and human review |
| over-strict schema | useful outputs fail for harmless variation | keep schemas minimal and validators specific |
| under-strict schema | invalid downstream package passes | add invalid fixtures and CI checks |

## Recommended pattern

```text
Prompt instruction
  -> structured output schema
  -> static validator
  -> invalid fixture
  -> CI
  -> downstream rejection
```
