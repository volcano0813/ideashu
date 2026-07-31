# IdeaShu agent guidance

IdeaShu is a local-first content control plane. The web UI and MCP use the same loopback Domain Service; SQLite is the only authoritative business store.

- Always select an explicit content account before writing.
- Treat `workflow.accountId` as immutable. Never use the UI's currently viewed account to rewrite a run scope.
- Use MCP tools for agent writes. Approval and package creation belong to the local operator web UI.
- Preserve immutable draft, review, cover, and package revisions. Resolve 409 conflicts by reloading, never by forced overwrite.
- Keep image-provider secrets outside the frontend, database, logs, and repository.
- Use `$ideashu-create`, `$ideashu-review`, and `$ideashu-cover` for the three content workflows.

Run `npm run verify` before committing runtime changes.
