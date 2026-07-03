---
title: "Multimodal and Image Prompting"
version: "2026.3"
status: "canonical"
---

# Multimodal and Image Prompting

<!-- peac-rule-id: multimodal.text_logo_caveat -->
Exact text, logos, typography, identity preservation, and layout parity in image generation or editing are model-dependent and must be treated as reliability risks, not guaranteed outcomes.
<!-- /peac-rule-id -->

## Principles

1. Separate identity-preservation requirements from style requirements.
2. Do not blend identities from multiple source images unless explicitly requested and safe.
3. Treat source photos and reference images as evidence with different roles.
4. For exact text and logos, prefer overlay-safe or post-processing workflows when fidelity matters.
5. Include a visual QA checklist for final review.

## Prompt structure

```text
ROLE
MISSION
SOURCE ROLES
PRESERVE
CHANGE
DO NOT CHANGE
TEXT / LOGO POLICY
COMPOSITION
QUALITY BAR
NEGATIVE CONSTRAINTS
FINAL QA CHECKLIST
```

## Overlay-safe workflow

Use when exact Persian/Arabic text, brand logos, certificates, or official marks must remain accurate:

```text
1. Generate or edit the visual scene without final critical text/logo.
2. Add exact text/logo in a controlled design tool or post-processing layer.
3. Run final human visual QA.
```

## QA checklist

- identity preserved
- no extra people or missing people
- hands, face, eyes, and documents plausible
- requested text present and readable
- no fake background text
- logos not redrawn incorrectly
- composition matches requested aspect ratio
