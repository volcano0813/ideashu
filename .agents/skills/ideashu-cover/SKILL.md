---
name: ideashu-cover
description: Create IdeaShu cover variants using text-free backgrounds, editable deterministic Chinese composition, and visual QA for an operator-approved draft.
---

# IdeaShu Cover

Keep background pixels and Chinese text separate. Never ask an image model to render the final Chinese title.

## Workflow

1. Call `ideashu_workflow_get` with the stable `agentRunId` bound to the workflow. Continue only for `draft_approved` or `covering`, targeting `approvedDraftRevision` exactly.
2. Derive a brief: visual subject, mood, palette, negative constraints, and explicit `no text, no letters, no logo`.
3. When a provider exists, generate two or three text-free 3:4 backgrounds under `.ideashu/imports`, then call `ideashu_artifact_import` as `cover_background`.
4. Without a provider or key, say so and use the built-in local gradient. Never claim AI generation succeeded.
5. Create editable composition data: short Chinese title, subtitle, 1080×1440 canvas, safe margin, colors, and alignment.
6. Call `ideashu_cover_variant_create`. IdeaShu deterministically renders and stores an SVG revision.
7. QA ratio, title length, legibility, safe area, account fit, absence of model-rendered text, and exact draft match.
8. Stop for operator approval in the web UI.

Never reuse artifact IDs across accounts, approve a cover, or build a package. Do not blindly retry an uncertain paid provider request.
