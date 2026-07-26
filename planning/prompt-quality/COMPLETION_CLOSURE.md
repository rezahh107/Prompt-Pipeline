# Prompt Quality Completion Closure

<!-- completion-authority-contract.v1|task_fields=completion_contract,completion_validation|contract_fields=contract_id,contract_version,task_id,required_changed_paths,required_artifact_paths,required_validation_script_ids,forbidden_changed_paths|claim_fields=validation_status,tested_commit,source,validation_profile,ci_run_reference|authority_sequence=closure>subject>authority_anchor>authority_blobs>preactivated_contract>contract_satisfaction>subject_profile>anchor_ci>subject_ci -->

## Authority sequence

A persisted `completion_validation` object is a consistency assertion. It does not select the authoritative commit, authority definition, Task contract, execution profile, or GitHub Actions run.

For every Task whose state is `complete`, the validator derives authority from Git history in this exact order:

1. Find the unique first commit where that Task changes from non-complete to `complete`; this is the **closure commit**.
2. Require the closure to have exactly one parent; that direct parent is the **completion subject**.
3. Require the subject to have a first parent; that first parent is the **authority anchor**.
4. Load the completion-authority inventory from the anchor and require every listed regular-file blob to be identical between anchor and subject.
5. Load the Task's non-null `completion_contract` from the anchor and require it to remain identical in subject, closure, and validation Head.
6. Require the subject first-parent delta and subject tree to satisfy the contract.
7. Validate the subject's canonical `peac-canonical-ci.v1` profile.
8. Require successful canonical exact-SHA CI for the authority anchor.
9. Require successful canonical exact-SHA CI for the completion subject.

The persisted `tested_commit`, `validation_profile`, and `ci_run_reference` must match the derived subject, fixed profile identifier, and uniquely accepted subject run. They cannot select an older ancestor, redefine authority, or select another successful run.

## Authority inventory boundary

The inventory is declared in `scripts/prompt-quality-program/evidence.mjs` at the authority anchor and includes at least:

```text
scripts/prompt-quality-program/core.mjs
scripts/prompt-quality-program/evidence.mjs
scripts/prompt-quality-program/program.mjs
scripts/peac-prompt-quality-program.mjs
scripts/peac-prompt-quality-program-self-test.mjs
planning/prompt-quality/schemas/prompt-quality-execution-program.v2.schema.json
package.json
.github/workflows/ci.yml
```

A completing subject may not add, remove, replace, or mutate any authority-inventory path. A legitimate authority revision must be an earlier non-completion commit, receive canonical exact-SHA CI, and then serve as or precede the later subject's authority anchor. Green subject CI does not excuse authority drift.

## Task completion contract

Every v2 Task contains Schema-required `completion_contract` and `completion_validation` fields. `completion_contract` may be `null` before activation. A completed Task requires a non-null contract already present at the authority anchor.

The contract has exactly:

```text
contract_id
contract_version
task_id
required_changed_paths
required_artifact_paths
required_validation_script_ids
forbidden_changed_paths
```

The contract must be non-vacuous, Task-matched, and repository-relative. `required_changed_paths` must appear in the authority-anchor-to-subject first-parent delta. `required_artifact_paths` must exist as regular files in the subject tree. `required_validation_script_ids` must be bindings verified by the canonical profile. `forbidden_changed_paths` must not appear in the first-parent delta.

A contract created or changed by the completing subject is invalid. A contract changed by the closure or a later descendant invalidates completion. Required changes or artifacts present only in another Merge parent are insufficient.

All current `PPQR-001` through `PPQR-015` contracts remain `null`; this repair does not complete or activate a Task contract.

## Closure boundary

The closure commit must change exactly:

```text
planning/prompt-quality/prompt-quality-execution-program.v2.json
planning/NEXT_WORK.md
```

Within the program, only one Task may transition to `complete`, and only its `state` and `completion_validation` fields may change. `completion_contract` must remain unchanged.

Within `planning/NEXT_WORK.md`, text outside the bounded status block must remain unchanged. Changes inside the block are limited to:

```text
current_task
task_status
blocked_by
last_completed_task
next_action
```

`last_completed_task` must become the completed Task ID. A closure containing implementation, schema, workflow, test, architecture-plan, contract activation, or unrelated Task changes is invalid.

## First-parent subject semantics

A zero-parent subject is rejected. A one-parent subject is compared with its only parent. A multi-parent Merge subject is compared only with its first parent. The validator does not union paths across parents and does not treat a Merge commit as automatically substantive.

The subject must satisfy its activated contract through this first-parent delta. An unrelated non-bookkeeping change is not sufficient.

## Validator-owned canonical profile

`peac-canonical-ci.v1` remains defined by the Prompt Quality validator. The subject versions of `.github/workflows/ci.yml` and `package.json` are candidate implementations checked against the anchor-owned authority blobs and the normalized profile; they are not independent authorities.

The profile preserves the closed ordered `scripts.ci` chain, exact script bindings, Runtime Authority, Prompt Quality validation, renderer checks, bundle checks, smoke `--mode ci`, exact checkout, frozen install, blocking execution, and rejection of failure suppression.

## Canonical run evidence

After local authority, contract, and profile checks succeed, the adapter derives canonical runs by exact SHA. Both anchor and subject runs must belong to `rezahh107/Prompt-Pipeline`, workflow ID `302284939`, workflow name `CI`, and successful job `PEaC canonical exact-head CI`.

The adapter queries by derived SHAs. It does not fetch a run selected by `ci_run_reference`. Anchor success does not replace subject success, and subject success does not replace authority or contract validation.

## Descendant behavior

A valid historical completion remains authoritative on ordinary descendant Heads when closure ancestry, anchor and subject identities, authority blobs, contract, subject profile, anchor run, subject run, and completed Task data remain valid. A later legitimate authority revision does not invalidate an earlier completion when it does not mutate that historical Task or contract.

## Non-authoritative mechanisms

The following do not authorize completion:

- arbitrary repository changes;
- Task purpose prose without a preactivated contract;
- contract activation by the completing subject;
- a profile label without matching anchor-owned topology;
- workflow or job names without exact-SHA evidence;
- local-only validation;
- free-form command strings;
- raw GitHub payload files;
- receipt or lifecycle ledgers;
- owner or Merge-actor identity;
- immutable Scope chains or governance hash chains.

Historical v1 records remain read-only and are not reactivated.
