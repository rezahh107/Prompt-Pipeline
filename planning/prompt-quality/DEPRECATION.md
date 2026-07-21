# Deprecated Prompt Quality Governance Model

## Status

The enterprise-style governance model introduced by the v1 Prompt Quality activation is retired from **active enforcement** for this personal repository.

The records remain historical and read-only. They are not current completion authorities and are not prerequisites for `PPQR-001` or later substantive Tasks.

## Historical records preserved

The following areas may contain historical v1 records:

```text
planning/prompt-quality/current-scope.json
planning/prompt-quality/scopes/**
planning/prompt-quality/lifecycle/**
planning/prompt-quality/evidence/**
planning/prompt-quality/impacts/**
planning/prompt-quality/schemas/prompt-pipeline-*.v1.schema.json
planning/prompt-quality/prompt-quality-execution-program.v1.json
planning/prompt-quality/diagnostics/prompt-quality-diagnostics.v1.json
```

Do not delete, rewrite, rehash, or reorder those historical records as part of normal work.

## Retired active mechanisms

Do not create or require new:

- exact `merged_by` identity evidence;
- owner-only Merge completion invariants;
- raw GitHub PR payload copies;
- exact-head, owner-Merge, exact-main, or workflow-artifact receipts;
- receipt, event, ledger, or impact hashes;
- receipt or lifecycle replay protection;
- append-only lifecycle or impact ceremonies;
- immutable Scope amendment chains or authorization-commit timing proofs;
- strict reconciliation carrier-descendant validation;
- post-Merge reconciliation before substantive quality work.

## Active authorities

Going forward:

- `planning/NEXT_WORK.md` is the sole mutable current-status authority;
- `planning/prompt-quality/prompt-quality-execution-program.v2.json` is the Task registry and dependency authority;
- Git and GitHub are authoritative for commits, history, pull requests, checks, Merge commits, and ancestry;
- canonical CI remains blocking and fail-closed;
- Scope and independent review are risk-based.

## Validation truthfulness

A PASS claim must identify the tested commit, source, commands, and CI run when available. Missing or inaccessible evidence must be reported as `unavailable` or `not_run`, never inferred as passing.
