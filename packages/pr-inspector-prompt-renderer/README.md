# @rezahh107/pr-inspector-prompt-renderer

Deterministic, offline renderer for canonical PR-Inspector next-action prompts and human handoffs.

This package validates action data selected by PR-Inspector. It does not select actions, call an LLM, modify repositories, approve, merge, deploy, or close findings.

```bash
pr-inspector-prompt-renderer render --input input.json
cat input.json | pr-inspector-prompt-renderer render
pr-inspector-prompt-renderer version
pr-inspector-prompt-renderer contract
```

Success is one JSON object on stdout. Diagnostics use stderr. No-prompt actions return `rendered_prompt: null`.

Development version: `0.1.0`. Publication is intentionally out of scope for this change.
