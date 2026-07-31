---
name: ideashu-create
description: Create sourced, account-scoped IdeaShu topic candidates and immutable draft revisions through the local IdeaShu MCP server.
---

# IdeaShu Create

Treat IdeaShu as the source of truth. Do not keep authoritative state only in chat or local files.

## Workflow

1. Call `ideashu_accounts_list`. Ask the user to choose when the account is ambiguous; never guess from prior chat.
2. Create one stable `agentRunId` for this execution.
3. Call `ideashu_account_get_context` and `ideashu_materials_search` for the selected account with that run ID. Reuse each `idempotencyKey` only when retrying the exact same write.
4. Create or read the workflow with `ideashu_workflow_create` / `ideashu_workflow_get`.
5. Research enough evidence for the request. Submit structured candidates through `ideashu_topics_submit`, including source URLs for current claims.
6. Stop for the operator to approve a topic in the web UI.
7. After approval, create an immutable revision with `ideashu_draft_revision_create`. Use the exact workflow and draft revisions from the latest snapshot.
8. Hand off to `$ideashu-review` before asking the operator to approve the draft.

## Invariants

- A workflow is permanently locked to its account. Never substitute the currently viewed account.
- Do not call approval or publishing endpoints outside MCP. Missing approval tools are an intentional security boundary.
- Do not invent evidence, account voice, or approval state.
- On `REVISION_CONFLICT`, fetch a new snapshot and show the conflict; do not overwrite silently.
- On `IDEMPOTENCY_KEY_REUSED`, use a new key only for a genuinely different request.
