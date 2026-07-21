# Next Work — Prompt Quality and Migration Program

This file is the **sole mutable current-status authority** for the Prompt Quality and Migration execution program.

The machine-readable program defines Task IDs, titles, purposes, dependencies, and Task state. GitHub and Git remain authoritative for commits, pull requests, checks, Merge history, and ancestry.

<!-- prompt-quality-status:start -->
```json
{
  "active_program": "PROMPT-QUALITY-MIGRATION-EXECUTION-PROGRAM",
  "operating_model": "BALANCED_PERSONAL_REPOSITORY",
  "current_task": "PPQR-001",
  "task_status": "not_started",
  "blocked_by": [],
  "last_completed_task": null,
  "next_action": "Implement PPQR-001 in a separate focused change after this governance simplification is accepted."
}
```
<!-- prompt-quality-status:end -->

## Current decision

`PPQR-001 — Program Ledger and Legacy Quality Baseline` is the next eligible substantive Task. It has not started and is not implemented by the governance-simplification change.

`PPQR-002` through `PPQR-015` remain governed by the approved dependency graph in:

```text
planning/prompt-quality/prompt-quality-execution-program.v2.json
```

Administrative activation reconciliation, owner-Merge receipts, exact-main receipts, lifecycle events, impact hashes, and immutable Scope amendments are not prerequisites for substantive work.

## Validation reporting

Any validation claim must identify the tested commit and the commands actually executed:

```yaml
validation_status: passed | failed | not_run | unavailable
tested_commit: <sha-or-null>
source: github_actions | local | unavailable
commands:
  - <executed-command>
ci_run_reference: <run-id-or-null>
```

Do not infer CI success from documentation, a stale PR description, or a different commit.
