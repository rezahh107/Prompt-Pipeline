# GitHub Workflow

## Branch strategy

- `main`: stable branch.
- `feat/*`: feature work.
- `fix/*`: bug fixes.
- `docs/*`: documentation-only changes.
- `chore/*`: maintenance.

## Commit style

Use conventional commits:

- `feat:` new capability
- `fix:` bug fix
- `docs:` documentation
- `chore:` maintenance
- `test:` test/eval changes
- `refactor:` internal restructuring

## Pull request checklist

- [ ] Changes are isolated to one purpose.
- [ ] Static validation passes.
- [ ] Rule drift check passes or drift is intentionally synced.
- [ ] Generated artifacts are not committed except golden outputs.
- [ ] No secrets or API keys are committed.
