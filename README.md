# IdeaShu

IdeaShu is a local-first content control plane. A React website handles accounts, materials, workflow state, immutable revisions, cover composition, and human approvals. Codex, WorkBuddy, or another desktop host connects through one stdio MCP server and remains replaceable.

## Phase 1 boundary

- Windows 10/11, PowerShell, and Node `>=22.13 <23`.
- One local operator and workspace, with multiple isolated content accounts.
- SQLite is the only business source of truth; runtime data lives under `.ideashu/` and is never committed.
- Three human gates: topic, exact draft revision, exact QA-passed cover.
- Cover generation separates text-free backgrounds from deterministic editable Chinese SVG composition.
- Provider keys are optional. Without one, the local gradient renderer still produces a valid cover; it does not pretend an AI background was generated.
- Codex or WorkBuddy installation and sign-in are not performed by this repository.

## Install and start

```powershell
git clone https://github.com/volcano0813/ideashu.git
cd ideashu
.\setup.ps1
npm start
```

Open [http://127.0.0.1:3210](http://127.0.0.1:3210). The production service binds only to loopback and serves the built SPA plus `/api/v1` from the same origin.

For development, run `npm run dev`; the Vite UI runs on `127.0.0.1:5173` and proxies only `/api` to the local service.

## Connect Codex or WorkBuddy

Run `npm run bootstrap` to print the exact absolute MCP command. The host configuration shape is:

```json
{
  "mcpServers": {
    "ideashu": {
      "command": "node",
      "args": ["D:/ABSOLUTE/PATH/ideashu/server/src/mcp.js"]
    }
  }
}
```

Start IdeaShu with `npm start` before the host calls MCP. The MCP server can start from any current directory, reads its local token from `.ideashu/runtime`, writes no logs to stdout, and exposes no approval or publishing tools.

The repository includes:

- `.agents/skills/ideashu-create`
- `.agents/skills/ideashu-review`
- `.agents/skills/ideashu-cover`

See [desktop host details](docs/agent-hosts.md).

## Legacy data migration

The website's **旧数据导出** page downloads a read-only browser backup with one SHA-256 per original localStorage value. It never deletes browser data.

Create an explicit account mapping:

```json
{
  "legacy-account-id": "new-ideashu-account-uuid",
  "default": "new-ideashu-account-uuid"
}
```

Dry-run first:

```powershell
npm run migrate:legacy -- --source .\browser-export.json --mapping .\mapping.json
```

Apply only after the report has no quarantined or ambiguous records:

```powershell
npm run migrate:legacy -- --source .\browser-export.json --mapping .\mapping.json --apply
```

The same command recognizes the old `sync/data.json` shape. Apply creates a SHA-named source backup under `.ideashu/migration-backups`, imports all records in one database transaction, deduplicates by account and content hash, and never copies unscoped data to every account.

## Verification

```powershell
npm run verify
```

This runs frontend/server lint, TypeScript, unit and integration tests, MCP stdio handshake, account-isolation and migration cases, production build, and local diagnostics.

Useful commands:

```powershell
npm run doctor
npm run test:integration
npm run build
```

## Security model

- API listens only on `127.0.0.1`.
- Browser access uses a same-origin HttpOnly local session; desktop agents use a separate bearer token kept outside the frontend and database.
- Origin checks reject unrelated web pages; account-scoped composite foreign keys prevent accidental cross-account references.
- Draft revisions and publish packages are immutable; writes require idempotency keys and optimistic revisions.
- Local authentication prevents accidental access and browser cross-origin attacks. It does not defend against malicious software already running as the same operating-system user.

If startup fails, confirm Node is in the supported release line, run `npm run doctor`, and verify port `3210` is free. Runtime files and credentials are not part of a clone and are regenerated locally.
