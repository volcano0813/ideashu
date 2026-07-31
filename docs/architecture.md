# Phase 1 architecture

```text
React SPA ── same-origin REST/SSE ──> Domain Service ──> SQLite + artifact store
                                           ↑
Codex / WorkBuddy ── stdio MCP ── loopback HTTP
```

## Authority boundaries

- The Domain Service is the only business writer. MCP never opens SQLite.
- A workflow stores an immutable `account_id`; page-level account switching cannot change it.
- Agent tools submit candidates, revisions, reviews, artifacts, and cover variants. They cannot approve or package.
- The web operator has three explicit gates: topic, exact reviewed draft revision, exact QA-passed cover.
- SSE is an invalidation channel. REST snapshots remain authoritative.

## Persistence invariants

- SQLite enables foreign keys, WAL, busy timeout, transactional migrations, and account-scoped indexes.
- Scope-bearing entities use workspace/account composite references. Additional triggers reject draft, review, cover, and package scope mismatches.
- Draft revisions, reviews, cover variants, publish packages, and audit events are immutable.
- Every write has an idempotency record in the same transaction as the business row and audit event.
- Optimistic workflow/draft revisions return 409 instead of overwriting concurrent work.
- Artifacts are content-addressed files; SQLite stores hash, MIME, byte count, provenance, and a relative path.

## Cover pipeline

```text
approved draft revision
  → text-free background brief
  → optional host/provider background artifact
  → editable Chinese composition JSON
  → deterministic SVG render
  → visual QA
  → operator approval
```

The local gradient renderer is the no-key fallback. External provider ambiguity is handled by the host; IdeaShu does not blindly retry a possibly billed request.

## Deferred beyond Phase 1

Cloud hosting, remote MCP, team RBAC, mobile clients, automatic platform publishing, schedules, cross-device sync, and long-running multi-agent orchestration are deliberately outside this release.
