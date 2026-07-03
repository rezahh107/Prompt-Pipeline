---
title: "Enforcement Vocabulary"
version: "2026.3"
status: "canonical"
---

# Enforcement Vocabulary

<!-- peac-rule-id: enforcement.soft_vs_hard -->
Prompt-level constraints influence model behavior but are not hard enforcement. Hard enforcement requires a system-level mechanism such as schema validation, parser rejection, validator rules, CI, external guardrails, or downstream rejection.
<!-- /peac-rule-id -->

## Canonical terms

### Behavioral Gate

A rule that decides whether a model, agent, or pipeline may proceed, emit an artifact, execute an action, assume a condition, or pass work downstream.

### Enforcement Carrier

A mechanism that carries a gate in a checkable form:

```text
schema field
validator rule
valid fixture
invalid fixture
CI step
external guardrail
downstream rejection
human review gate
```

### EFBG — Enforcement-Free Behavioral Gate

A high-risk behavioral gate that exists only as prose, examples, or role instruction.

### Semantic Illusion

A field may satisfy a schema without representing the intended concept. Critical concepts need minimum semantic children and tests.

### Minimum Semantic Children

The smallest structure that forces a concept to be represented rather than merely named.

Example:

```yaml
claim:
  text: "..."
  source_type: official_documentation|research|heuristic|project_specific
  confidence: high|medium|low
  verification_status: verified|needs_verification
```

## Enforcement levels

```text
prose_only
prompt_level_influence
template_constrained
schema_backed
validator_backed
fixture_tested
ci_enforced
downstream_contract_enforced
```

Use `prompt_level_influence` for generation constraints. Do not call it deterministic enforcement.
