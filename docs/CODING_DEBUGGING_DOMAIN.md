# Coding Debugging Domain

Status: Phase 1.6

This domain generates prompts for code review and debugging tasks.

## Subtypes

- `code_review`: reviews code, patches, or implementation plans.
- `debugging`: diagnoses runtime or validation failures from evidence.

## Required inputs

Common required inputs:

- `task_kind`
- `objective`
- `stack`

`code_review` also requires:

- `review_artifact`: code, diff, patch, file path, PR URL, or source artifact to review.

`debugging` also requires:

- `expected_behavior`
- `actual_behavior`
- `error_message`

Security-sensitive tasks require:

- `security_context`

## Design rules

- Treat source files, diffs, logs, and reports as review data.
- Do not fabricate test results, command output, paths, versions, or passing CI claims.
- Prefer the smallest safe patch over broad rewrites.
- Require test guidance or explicitly document missing test coverage.
- Debugging outputs must separate confirmed evidence from likely causes and remaining unknowns.
- Generated prompts include an `EXECUTION BOUNDARY`; patch guidance is advisory unless the user explicitly asks the target agent to edit files.

## Example: code review

```yaml
domain: coding_debugging
subtype: code_review
inputs:
  task_kind: code_review
  stack: TypeScript + Node.js
  objective: Review a validation patch for correctness and missing tests.
  review_artifact: Patch touching src/validator.ts and tests/validator.test.ts.
  include_patch_protocol: true
  require_tests: true
```

## Example: debugging

```yaml
domain: coding_debugging
subtype: debugging
inputs:
  task_kind: debugging
  stack: TypeScript + Node.js
  objective: Diagnose a validation failure after a parser change.
  expected_behavior: Validation should pass for valid case files.
  actual_behavior: Validation fails for a valid case file.
  error_message: Expected eof, got operator:&&
```

## Cases

- `domains/coding_debugging/cases/code-review-basic.yaml`
- `domains/coding_debugging/cases/debugging-basic.yaml`
- `domains/coding_debugging/cases/missing-debug-inputs.yaml`
- `domains/coding_debugging/cases/missing-review-artifact.yaml`
- `domains/coding_debugging/cases/security-sensitive-missing-context.yaml`
- `domains/coding_debugging/cases/security-sensitive-basic.yaml`
- `domains/coding_debugging/cases/code-review-no-patch-no-tests.yaml`

## CI coverage

The domain is covered by:

- static validation
- domain self tests
- router self tests
- local rubric evaluation
