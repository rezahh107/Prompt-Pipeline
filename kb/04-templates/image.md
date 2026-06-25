# Image Prompting Template

<!-- peac-rule-id: image.identity.preservation -->
For identity-preserving image edits, preserve all visible people from the source photo: count, faces, identity, apparent age, skin tone, hairstyle, clothing, posture, body proportions, hands, and natural relative positions.
<!-- /peac-rule-id -->

<!-- peac-rule-id: image.overlay.exact_text -->
Exact Persian text, specific fonts, official logos, QR codes, rankings, grades, and formal identifiers should be handled with deterministic overlay when fidelity matters. The image model should create the visual base, not exact text or official brand marks.
<!-- /peac-rule-id -->

<!-- peac-rule-id: image.safe_area -->
When deterministic overlay is required, reserve a clean safe area. Default: top 25% of the canvas, empty and free from faces, hands, and important documents.
<!-- /peac-rule-id -->
