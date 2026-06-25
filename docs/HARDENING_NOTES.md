# PEaC Hardening Notes

## Lockfile policy

`pnpm-lock.yaml` must be generated from a real local install, not hand-authored.

Required local step before switching CI to frozen installs:

```bash
pnpm install
git add pnpm-lock.yaml
git commit -m "chore: add pnpm lockfile"
```

After the lockfile is committed, update CI from:

```bash
pnpm install --no-frozen-lockfile
```

to:

```bash
pnpm install --frozen-lockfile
```

## Branch protection policy

Enable these repository settings for `main`:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Require the branch to be up to date before merging.
- Require conversation resolution before merging.
- Block force pushes.
- Restrict direct pushes to `main` where possible.

These are repository settings, not source-controlled files, so they must be configured in GitHub Settings.

## Expression policy

PEaC expressions are intentionally not JavaScript. The supported expression subset is limited to:

- identifiers
- string, number, boolean, and null literals
- `==`, `===`, `!=`, `!==`, `>`, `>=`, `<`, `<=`
- `&&`, `||`, `!`
- parentheses
- `.length` on arrays and strings

Do not add arbitrary JavaScript execution to contract, route, policy, or validator expressions.
