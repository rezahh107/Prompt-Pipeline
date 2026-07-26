# Prompt Quality Completion Closure

## Authority

A persisted `completion_validation` object is a consistency assertion. It does not select the authoritative commit or GitHub Actions run.

For every Task whose state is `complete`, the validator derives authority from Git history:

1. Find the unique first commit where that Task changes from a non-complete state to `complete`.
2. Treat that commit as the **closure commit**.
3. Require the closure to have exactly one parent.
4. Treat the direct parent as the only valid **completion subject**.
5. Require canonical GitHub Actions evidence whose exact Head SHA is that subject.

The persisted `tested_commit` and `ci_run_reference` must equal the derived subject and the uniquely accepted canonical run. They cannot point to another ancestor or another successful run.

## Closure boundary

The closure commit must change exactly:

```text
planning/prompt-quality/prompt-quality-execution-program.v2.json
planning/NEXT_WORK.md
```

Within the program, only one Task may transition to `complete`, and only its `state` and `completion_validation` fields may change.

Within `planning/NEXT_WORK.md`, text outside the bounded status block must remain unchanged. Changes inside the block are limited to:

```text
current_task
task_status
blocked_by
last_completed_task
next_action
```

`last_completed_task` must become the completed Task ID.

The subject commit must contain at least one change outside those two bookkeeping paths. A closure containing implementation, schema, workflow, test, architecture-plan, or unrelated Task changes is invalid.

## Canonical evidence

The derived subject requires exactly one accepted run with:

```yaml
repository: rezahh107/Prompt-Pipeline
workflow_id: 302284939
workflow_name: CI
job_name: PEaC canonical exact-head CI
run_status: completed
run_conclusion: success
job_status: completed
job_conclusion: success
head_sha: <derived direct-parent subject>
validation_profile: peac-canonical-ci.v1
```

The adapter queries runs by the derived subject SHA. It does not fetch a run selected by `ci_run_reference`.

## Descendant behavior

A valid historical completion remains authoritative on ordinary descendant Heads when:

- the closure remains an ancestor;
- the completed Task object and completion assertion remain byte-equivalent in parsed JSON meaning;
- the first transition history is unchanged;
- the canonical exact-subject evidence remains valid.

A later mutation of the completed Task or its assertion invalidates completion with `PQG_COMPLETION_HISTORY_DRIFT`.

## Non-authoritative mechanisms

The following do not authorize completion:

- arbitrary older successful ancestor runs;
- local-only validation;
- free-form command strings;
- raw GitHub payload files;
- receipt or lifecycle ledgers;
- owner or Merge-actor identity;
- immutable Scope chains or governance hash chains.

Historical v1 records remain read-only and are not reactivated.
