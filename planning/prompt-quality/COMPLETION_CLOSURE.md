# Prompt Quality Completion Closure

## Authority

A persisted `completion_validation` object is a consistency assertion. It does not select the authoritative commit, execution profile, or GitHub Actions run.

For every Task whose state is `complete`, the validator derives authority from Git history:

1. Find the unique first commit where that Task changes from a non-complete state to `complete`.
2. Treat that commit as the **closure commit**.
3. Require the closure to have exactly one parent.
4. Treat the direct parent as the only valid **completion subject**.
5. Derive and verify the subject's validator-owned canonical execution profile.
6. Require canonical GitHub Actions evidence whose exact Head SHA is that subject.

The persisted `tested_commit`, `validation_profile`, and `ci_run_reference` must equal the derived subject, the validator-owned profile identifier, and the uniquely accepted canonical run. They cannot select another ancestor, redefine the profile, or select another successful run.

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

## Subject tree comparison

Subject scope is derived from Git parentage and trees:

- a zero-parent subject is rejected because no predecessor tree is available;
- a one-parent subject is compared with its only parent;
- a multi-parent merge subject is compared only with its first parent.

The validator does not use bare merge `diff-tree` output and does not union paths across parents. A substantive path that exists only in another merge parent cannot satisfy the subject-scope requirement when it is absent from the first-parent-to-subject tree difference.

The closure remains a single-parent direct child of the subject regardless of whether the subject itself is a normal commit or a merge commit.

## Validator-owned canonical profile

`peac-canonical-ci.v1` is defined by the Prompt Quality validator. The subject versions of `.github/workflows/ci.yml` and `package.json` are candidate implementations of that profile; they are not profile authorities.

The package profile requires:

- `scripts.ci` to be a closed, ordered `&&` chain;
- the exact required typecheck, runtime CLI, self, router, domain, intake, validation, evaluation, output-contract, behavioral, production, human-review, model, context, artifact, provenance, Runtime Authority, Prompt Quality, renderer, bundle, and smoke stages;
- validator-owned bindings for the scripts invoked by that chain;
- smoke execution with `--mode ci`;
- no alternate shell control operator or success-suppression mechanism.

The canonical workflow profile requires:

- job name `PEaC canonical exact-head CI`;
- checkout of `${{ env.TESTED_SHA }}` with complete history;
- mechanical verification that checked-out `HEAD` equals `TESTED_SHA`;
- `pnpm install --frozen-lockfile`;
- blocking renderer test and renderer pack-check commands;
- blocking `pnpm run ci` execution;
- explicit bundle-output verification;
- no `continue-on-error`, `|| true`, `set +e`, terminal `true`, or equivalent failure suppression in required steps.

A same-name green workflow does not authorize completion when the subject profile is missing, unparsable, weakened, bypassed, or otherwise different from the validator-owned v1 semantics. A materially different future topology requires an intentional new profile version or an explicit validator-owned revision.

## Canonical run evidence

After subject profile validation succeeds, the derived subject requires exactly one accepted run with:

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

The adapter queries runs by the derived subject SHA. It does not fetch a run selected by `ci_run_reference`, and run success cannot replace profile validation.

## Descendant behavior

A valid historical completion remains authoritative on ordinary descendant Heads when:

- the closure remains an ancestor;
- the completed Task object and completion assertion remain byte-equivalent in parsed JSON meaning;
- the first transition history is unchanged;
- the subject profile remains valid at the exact historical subject;
- the canonical exact-subject evidence remains valid.

A later mutation of the completed Task or its assertion invalidates completion with `PQG_COMPLETION_HISTORY_DRIFT`.

## Non-authoritative mechanisms

The following do not authorize completion:

- arbitrary older successful ancestor runs;
- a profile label without matching subject topology;
- workflow or job names without parsed profile validation;
- local-only validation;
- free-form command strings;
- raw GitHub payload files;
- receipt or lifecycle ledgers;
- owner or Merge-actor identity;
- immutable Scope chains or governance hash chains.

Historical v1 records remain read-only and are not reactivated.
