# Setup

Developer setup notes for the Proyekto monorepo. Per-unit commands live in [CLAUDE.md](CLAUDE.md); this file covers shared local configuration.

## MCP servers

The repo ships a shared MCP configuration in [`.mcp.json`](.mcp.json) (project scope), so anyone using Claude Code gets the same servers:

| Server | Transport | Auth | Purpose |
| --- | --- | --- | --- |
| `supabase` | stdio (npx) | `SUPABASE_ACCESS_TOKEN` env var | Query/inspect the Supabase project |
| `cloudflare-docs` | SSE | none | Search Cloudflare documentation |
| `cloudflare-bindings` | SSE | per-user OAuth | Manage Workers / R2 / KV / D1 (used by `realtime/`) |

### Required environment variables

`.mcp.json` references secrets via `${VAR}` instead of hardcoding them, so each developer must set them in their own environment:

| Variable | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase dashboard → Account → Access Tokens → generate a personal token |

**Windows (PowerShell)** — sets a persistent user env var:

```powershell
setx SUPABASE_ACCESS_TOKEN "sbp_your_token"
```

**macOS / Linux** — add to your shell profile (`~/.zshrc`, `~/.bashrc`):

```bash
export SUPABASE_ACCESS_TOKEN="sbp_your_token"
```

`setx` / a new `export` only applies to **new** processes — fully restart your terminal and editor (VS Code / Claude Code) afterward. Verify with `echo $SUPABASE_ACCESS_TOKEN` (or `$env:SUPABASE_ACCESS_TOKEN` in PowerShell).

> Never commit a real token to `.mcp.json`. Use the `${VAR}` form. If a token is ever committed, rotate it in the Supabase dashboard.

### First run with Claude Code

1. Claude Code will prompt to approve the project-scoped MCP servers from `.mcp.json` — accept them.
2. `supabase` and `cloudflare-docs` connect automatically (given the env var above).
3. For `cloudflare-bindings`, run `/mcp`, select it, and choose **Authenticate** to log in to your own Cloudflare account via OAuth.
