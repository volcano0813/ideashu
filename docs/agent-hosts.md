# Desktop agent hosts

IdeaShu exposes one local stdio MCP server. Codex and WorkBuddy are replaceable hosts; neither owns IdeaShu state.

After `setup.ps1`, configure the host with:

```json
{
  "mcpServers": {
    "ideashu": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_IDEASHU/server/src/mcp.js"]
    }
  }
}
```

Use an absolute repository path so the MCP server starts when the host current directory is elsewhere. The service must already be running with `npm start`.

The repository ships Codex-compatible `SKILL.md` files and small `skill.yml` adapter manifests for WorkBuddy-style importers. Host installation and sign-in are outside IdeaShu; bootstrap prints configuration but does not pretend to install or authenticate a host.
