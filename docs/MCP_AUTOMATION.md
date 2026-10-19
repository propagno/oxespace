# MCP automation: first increment

The following read-only tools require a live OXESpace execution and an empty object:

- `oxespace_capabilities`: actual registered tool names, effective delegation opt-in,
  execution role, active delegation count, limit and reason creation is unavailable.
  Tool discovery is not permission to execute every tool; handlers recheck policy.
- `oxespace_execution_context`: bound workspace/pane/execution, launch cwd, agent
  profile, origin pane, locally hashed project identity and sampled Git branch/HEAD.
  The identity hash is not AI Memory's project UUID. Shell cwd after `cd` is unknown.
- `oxespace_memory_diagnostics`: run binding, project memory settings, runtime health,
  last admitted hook metadata and successful provider calls through MemoryManager.

New replies have `schemaVersion: 1`, requestId, status and data/error. Authorization
failures never include credentials. Missing optional services return partial results.
Errors include a stable code, message and retryable flag. Existing tools retain
their current reply format.

Hook timestamps live for the execution lifetime; provider observations are bounded
to 512 projects and live for the application lifetime. They are metadata only.
Write/read timestamps cover classified MCP operations; they do not measure all
native hook writes or all provider consumers. Runtime health checks are not writes.
Spool, native persistence and consolidation are explicitly `not_observable`.
No upstream AI Memory API or private spool-file format was introduced.

Example agent instruction:

> Call oxespace_capabilities and oxespace_execution_context before automating work.
> If memory continuity is uncertain, inspect oxespace_memory_diagnostics. Do not
> infer successful capture from runtime readiness or hook receipt alone.

Remaining increments are tracked in MCP_AUTOMATION_PLAN.md: durable operation
journal, events, structured handoff, dependencies/claims and terminal/layout control.


## App tools: levels, approvals and audit

Tools that reach the rest of the app (Git first; GitHub, Threads, Tasks and more follow) are one tool per
domain with an `action` argument, for example `oxespace_git` with `status`, `branch`, `diff_summary`, `diff`
and `file_at_ref`. The tool description lists every action with its level. The level is part of the tool,
never an argument, so a model cannot ask for less checking:

| Level | Who may call | What happens |
|---|---|---|
| `read` | Any caller with a workspace | Runs. Not recorded. |
| `write` | Only an agent with a live OXESpace execution (a Code pane or a Thread) | Rate limited (30 per minute per execution) and recorded. |
| `confirm` | As `write` | A native dialog shows the exact text; the grant is bound to its SHA-256, single use, five minutes. Answers `approval-pending` until the person decides; call again with the same arguments. |

Calls apply to the caller's own directory (the pane's or Thread's root); a caller without an execution
gets the workspace it names or the active one. Refusals have a stable `code`: `invalid`, `no-execution`,
`no-workspace`, `rate-limited`, `too-long`, `denied`, `approval-pending`, `unavailable`, `failed`.

Writes and confirmations are kept for 90 days in `agent_action_audit` (append-only). OxeQuery keeps its own
trail in `oxequery_audit`; both use the same approval broker (`services/agent-actions`).

Never exposed as tools, by design: answering a Thread's approvals or raising its access, permission rules,
sign-in and tokens, secrets and trust of external MCP servers, database credentials and host keys, agent
profiles, repository hooks, Web Preview access to external sites, delegation targets, deleting workspaces,
bulk cleanup of sessions or worktrees, app and RTK updates, clipboard and voice, and typing into another
agent's terminal.

## Importing servers from other tools

**Connections > Import from Claude Desktop, Cursor or Windsurf** lists the MCP servers those tools already have
(their user-level config files only) and adds the ones you pick to the current scope.

- Imported servers are added **untrusted**: review the command and trust each one before it runs.
- Secrets: the lists show names, commands, URLs and the *names* of environment variables and headers; the values are
  read again in the main process and never reach the interface.
- A server that carries a token, key or password cannot be saved untrusted. It is listed with that reason; add it by
  hand and mark it trusted.
- Pasted JSON accepts remote servers too (`url`, `headers`, `type` of `http`, `sse` or `streamable-http`).
- The project `.mcp.json` and the Claude Code user configuration are not imported: OXESpace writes the first and the
  CLIs read both themselves, so importing would start every server twice.

**Known limitation (release notes):** environment variables and headers of a server are stored in the OXESpace
database as saved, and are written in plain text to each project's `.mcp.json` when the servers sync. Encrypting the
database alone would not change that; treat `.mcp.json` as sensitive and keep it out of version control.

## Elicitation forms

When an MCP server asks for input through Codex, the form supports text with length and format limits (email, URL,
date), numbers and integers with bounds, yes/no, single and multiple choices with titles. Values are checked before
they are sent and the reason is shown on the field. Claude Code's own elicitation requests are not answered by the
form yet.
