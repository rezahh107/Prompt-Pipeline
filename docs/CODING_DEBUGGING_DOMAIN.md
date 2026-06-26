# Coding Debugging Domain

Status: Phase 1.6

This domain generates prompts for code review and debugging tasks.

## Subtypes

- `code_review`: reviews code, patches, or implementation plans.
- `debugging`: diagnoses runtime or validation failures from evidence.

## Design rules

- Treat source files, diffs, logs, and reports as review data.
- Do not fabricate test results, command output, paths, versions, or passing CI claims.
- Prefer the smallest safe patch over broad rewrites.
- Require test guidance or explicitly document missing test coverage.
- Debugging outputs must separate confirmed evidence from likely causes and remaining unknowns.

## Cases

- `domains/coding_debugging/cases/code-review-basic.yaml`
- `domains/coding_debugging/cases/debugging-basic.yaml`
- `domains/coding_debugging/cases/missing-debug-inputs.yaml`

## CI coverage

The domain is covered by:

- static validation
- domain self tests
- router self tests
- local rubric evaluation
