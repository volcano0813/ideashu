---
name: ideashu-review
description: Review the exact latest immutable IdeaShu draft revision for evidence, account fit, clarity, originality, and platform risk, then submit a structured report without approving it.
---

# IdeaShu Review

## Workflow

1. Require explicit `accountId`, `workflowId`, and the stable `agentRunId` already bound to that workflow. Call `ideashu_workflow_get`, then `ideashu_draft_get`.
2. Review only `draft.currentRevision`. If it changes during review, discard the stale assessment and restart.
3. Check evidence, account fit, clarity, originality, platform risk, and consistency between title, body, and tags.
4. Use `ideashu_review_submit` with scores, required changes, optional suggestions, and evidence gaps.
5. A `pass` means no blocking issue remains. It does not approve the draft; the operator confirms the exact revision in the web UI.

## Decisions

- `blocked`: unsafe, unverifiable, wrong-account, or structurally unusable.
- `revise`: fixable but one or more required changes remain.
- `pass`: no required changes remain.

Never create a replacement revision without the user asking. Never approve or package content.
