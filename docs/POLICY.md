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
  - `tool.use`: a tool name as the agent reports it (`Bash`, `mcp__github__create_issue`). As in Claude, `mcp__<server>` covers each of that server's tools;
  - `integration.use`: `mcp:<server>`, `skill:<id>`, `db:<connection>`, `memory`.
  - `integration.use` also accepts `env:<NAME>` and `net:<domain>` (see below);
  - `db.write`: `<environment>:<connection>`, with the environment `local`, `dev` or `prod` (`prod:*`, `*:reports-db`).
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
| `provider.use` | Yes. A Thread whose agent is blocked does not start (the conversation shows why), and a Code pane cannot launch `claude` or `codex` when blocked; a plain shell is never blocked. |
| `tool.use` | Yes, for tools that ask for approval: the request is declined with the reason, before saved rules and full access are considered. At launch, Claude gets the denied tools in `--disallowedTools` and Codex gets them as per-server `disabled_tools` (or the server off for a whole-server deny), so neither offers them. Codex built-in tools that run without asking are not seen by OXESpace. OXESpace's own MCP tools are also checked when called: a call from an agent OXESpace started answers to that agent's project; a call without that agent's execution token answers to the union of the denies of every registered project, so a generic MCP client working in project B can be refused by a deny written in project A. That is the safe side, not a bug. |
| `integration.use` `skill:<name>` | Yes, for skills OXESpace hands to the agent: a blocked OXE skill or Codex skill stays in the Thread command list, disabled, with the reason, and is refused when typed; a Code pane does not receive it. A skill the agent loads on its own (Claude's `Skill` tool) is a tool: block it with `tool.use` `Skill`. |
| `integration.use` `db:<connection>` | Yes. The OxeQuery agent tools refuse a blocked connection (by its name) before any other access rule, and `oxespace_db_connections` lists it as `blocked-by-policy`. People still use the connection in OxeQuery. |
| `db.write` `<environment>:<connection>` | Yes. A `deny` makes the connection read-only in OxeQuery whatever its own setting says: the editor refuses statements that change data, the toolbar reads "read-only by policy", and the connection form cannot lift it. Agents get the same read-only connection. A `deny` on `prod:*` is the usual rule; a later `allow` on one name lifts it for that connection. |
| `integration.use` `memory` | Yes. Shared memory is off for the project while blocked (no capture, no context, no memory tools), turning it on is refused with the reason, and the stored choice comes back when the rule is lifted. A project's identity is its Git repository, so the project layer read for memory is the main checkout's. |

| `integration.use` `env:<NAME>` | Yes, for processes OXESpace starts for an agent: a Code pane that launches `claude` or `codex`, a repository hook, an MCP server. Variables whose names look like secrets (TOKEN, SECRET, KEY, PASSWORD, CREDENTIAL, AUTH, and known cloud, CI and provider names) are not inherited. A provider keeps its own authentication variables (Claude: `ANTHROPIC_*`, `CLAUDE_*`, Bedrock and Vertex ones; Codex: `OPENAI_*`, `CODEX_*`). An `allow` on `env:GITHUB_TOKEN` lets one through; a `deny` withholds one even if the name looks harmless. Plain shell panes and other agents keep the full environment. Names withheld (never values) show in the diagnostics. |
| `integration.use` `net:<domain>` | **Not enforced.** The rule is read and evaluated (`decideNet`, default allow) and a command classifier exists, so a future prompt and a default-deny can use them. Enforcement needs the operating system sandbox (roadmap S3). `net:github.com` does not cover subdomains; write `net:*.github.com`. |

Settings › Policy shows the files that apply to the current workspace, their rules and any file that was set aside,
read only.

Servers configured only in a CLI's own user settings under another name cannot be seen by OXESpace; to block those,
deny them by their exact name, or use the provider's own managed settings.
