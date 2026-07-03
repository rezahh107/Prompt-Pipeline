---
title: "Prompt Engineering Knowledge Base"
version: "2026.3"
status: "canonical"
---

# Prompt Engineering as Code Knowledge Base

This folder is the human-readable source of truth. Stable `peac-rule-id` anchors are used by `pnpm peac:sync -- --check` to detect rule drift.

## Core formula

<!-- peac-rule-id: general.prompt_structure -->
Prompt = Task + Context + Constraints + Format + Examples + Validation.
For important work, add evidence rules, risk handling, and human review.
<!-- /peac-rule-id -->

## Knowledge modules

1. `01-core-principles.md` — baseline PEaC principles.
2. `02-*` / `03-prompt-injection.md` — existing safety and prompt-injection references.
3. `04-templates/` — domain template notes.
4. `05-enforcement-vocabulary.md` — canonical distinction between prompt-level influence and system-level enforcement.
5. `06-behavioral-rule-coverage.md` — risk-focused coverage model for behavioral gates.
6. `07-instruction-hierarchy.md` — instruction authority and external-content boundary.
7. `08-structured-outputs.md` — schema-guided outputs and semantic validation limits.
8. `09-safety-ethics.md` — existing safety and ethics baseline.
9. `10-multimodal-image-prompting.md` — image, multimodal, text/logo, and overlay-safe guidance.

## Operating principle

Use this KB to build rendered artifacts. Do not dump the entire KB into a model unless the task is to audit the KB itself.
