# Organization policy

A policy file blocks what agents may use, for one project, for one person or for every user of a machine. It never
grants anything OXESpace would not already do.

## Format

```json
{
  "organization": "Acme",
  "rules": [
    { "effect": "deny", "action": "integration.use", "resource": "mcp:*" },
    { "effect": "allow", "action": "integration.use", "resource": "mcp:github" }
  ]
}
```

- `effect`: `deny` blocks; `allow` only lifts an earlier `deny`.
- `action` and `resource` (names with `*` wildcards, compared without case):
  - `provider.use`: `claude`, `codex`;
  - `tool.use`: a tool name as the agent reports it (`Bash`, `mcp__github__create_issue`);
  - `integration.use`: `mcp:<server>`, `skill:<id>`, `db:<connection>`, `memory`.
- `organization` names who set the policy in the message people see ("… is blocked by Acme policy.").

## Where it is read

| Layer | File |
|---|---|
| Project | `<project>/.oxespace/policy.json` |
| User | `<userData>/policy.json` |
| Managed | Windows `%ProgramData%\OXESpace\policy.json`, Linux `/etc/oxespace/policy.json`, macOS `/Library/Application Support/OXESpace/policy.json` |

The layers are read in that order and the last rule that matches decides, so the managed file has the final word.
A file is read again when it changes; no restart is needed. A file that is not a valid policy is set aside whole,
never applied in part. Nothing in the app, a plugin or an MCP server writes a policy file.

## What it controls today

| Action | Enforced |
|---|---|
| `integration.use` `mcp:<server>` | Yes. A blocked server is not written into a project's `.mcp.json`, an entry with that name added by hand is removed on the next sync, OXESpace does not attach it to a Thread, and a server denied by exact name is excluded from the agent session (`--disallowedTools mcp__<server>` for Claude, `enabled=false` for Codex) even when it was configured directly in the CLI. |
| `provider.use`, `tool.use`, `integration.use` for skills, databases and memory | Next step (roadmap C1b). |

Servers configured only in a CLI's own user settings under another name cannot be seen by OXESpace; to block those,
deny them by their exact name, or use the provider's own managed settings.
