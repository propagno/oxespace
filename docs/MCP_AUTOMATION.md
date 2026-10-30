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
| `confirm` | As `write` | The app's approval modal shows the exact text (up to 100,000 characters; longer is refused `too-long`), with the requester named by the app; the system dialog only when no window exists. The grant is bound to its SHA-256, single use, five minutes. Answers `approval-pending` until the person decides; call again with the same arguments. |

Read tools available now (all `read`):

| Tool | Actions |
|---|---|
| `oxespace_git` | `status`, `branch`, `diff_summary`, `diff`, `file_at_ref` |
| `oxespace_github` | `status`, `branches`, `pull_requests`, `pull_request_status`, `commits`, `commit`, `releases`, `workflows`, `runs`, `run`, `run_logs` (cleaned, secrets masked) |
| `oxespace_threads` | `list`, `read`, `usage` — Threads of the caller's project only |
| `oxespace_tasks` | `list`, `ready`, `executions` — Code workspaces only |
| `oxespace_skills` | `list`, `get` |
| `oxespace_automations` | `list`, `runs` |
| `oxespace_linear` | `status`, `teams`, `issues`, `issue` |
| `oxespace_terminal` | `output` — recent output of a pane in the caller's Code workspace, escape codes removed and secrets masked; never a full-screen program |
| `oxespace_mcp_servers` | `list` — name, scope, transport, enabled, trusted, health and tool names; never commands, environment or headers |
| `oxespace_search` | `text` (ripgrep), `files` |
| `oxespace_usage` | `context`, `credits` |

Change tools (separate from the read tools, so a read-only Thread never gets them and the bridge never retries them):

| Tool | `write` (runs, recorded) | `confirm` (a person approves the exact text) |
|---|---|---|
| `oxespace_git_change` | `stage`, `stage_all`, `unstage`, `commit` (local), `create_branch` (no switch), `fetch`, `pull` (fast-forward only), `create_checkpoint` | `checkout`, `push`, `restore_checkpoint` |
| `oxespace_github_change` | — | `create_pull_request`, `set_auto_merge`, `create_release`, `run_workflow`, `rerun` |
| `oxespace_threads_change` | `send`, `steer`, `interrupt`, `configure` (model and effort only), `rename` on a Thread the caller created (handoff or Agent Work) | the same on any other Thread of the project, and `archive` |
| `oxespace_tasks_change` | `create`, `update`, `reorder`, `add_dependency`, `remove_dependency` | `verify` (shows the command), `delete` |

| `oxespace_skills_change` | — | `create` (the whole skill is shown) |
| `oxespace_automations_change` | `disable` | `create` (prompt, schedule and precheck shown; never extra CLI arguments), `enable`, `run_now`, `remove` — this project's automations only |
| `oxespace_workspace_change` | `notify` (desktop notification), `reindex` (semantic index, Code workspaces), `worktree_for_linear_issue` | — |

| `oxespace_mcp_servers_change` | `stop` | `start` (trusted servers only; never OXESpace's own bridge) |

OxeQuery keeps its own policy (per-connection agent access, approval of each data read and write) and gains
`oxespace_db_explain` (EXPLAIN without ANALYZE of one read statement; metadata, so no approval) and
`oxespace_db_activity` (its audit, statement text redacted). Connections, credentials, host keys, import and
export stay with the person.

### Agents in panes

After herdr's automation primitives (Apache-2.0, see `NOTICE`). Code workspaces only.

| Tool | Actions |
|---|---|
| `oxespace_agents` (read) | `list` (state of every agent pane: `working`, `blocked`, `done`, `idle`, `unknown`, and `completionSeq`), `read`, `explain`, `wait` (until a state, at most 100 s; call again on timeout) |
| `oxespace_agents_change` | `start` (write: a new pane with Claude Code or Codex from the person's profile, optional model; no other arguments), `prompt` and `interrupt` (no question on a pane the caller started, approval on any other), `close_pane` (confirm, own panes only) |

Nothing is ever written to an agent that is `blocked` (`agent_blocked`), there is no free key input, and an
agent never prompts its own pane. A prompt from a resting agent that shows no activity within 5 s returns
`stalled: true`: read the pane before sending it again.

Agent state comes from the agents' hooks (Claude Code, Codex) and from herdr's screen-detection manifests
for Claude Code, Codex, Copilot, Cursor, Gemini, Grok, OpenCode, Qwen, Kimi, Amp and Droid; a file in
`userData/agent-detection/<agent>.toml` replaces a bundled manifest.

Branch, tag and ref arguments that git could read as an option are refused. A Thread cannot act on itself.
Starting a task in an agent's terminal (`tasks.run`) is not a tool: it types into another agent's terminal.

Calls apply to the caller's own directory (the pane's or Thread's root); a caller without an execution
gets the workspace it names or the active one. Refusals have a stable `code`: `invalid`, `no-execution`,
`no-workspace`, `rate-limited`, `too-long`, `denied`, `approval-pending`, `unavailable`, `reserved-name`, `failed`.
`reserved-name` (B10): a pane name or a notification may not contain OXESpace, OxeChat, OxeCode, OxeQuery, OxePod or
OxePost (after case, accent and look-alike folding), nor be exactly System or Sistema. Notifications are limited to
six a minute per execution (`rate-limited`) and are shown with the app's own prefix naming the sender.

Writes and confirmations are kept for 90 days in `agent_action_audit` (append-only). OxeQuery keeps its own
trail in `oxequery_audit`; both use the same approval broker (`services/agent-actions`).

Never exposed as tools, by design: answering a Thread's approvals or raising its access, permission rules,
sign-in and tokens, secrets and trust of external MCP servers, database credentials and host keys, agent
profiles, repository hooks, Web Preview access to external sites, delegation targets, deleting workspaces,
bulk cleanup of sessions or worktrees, app and RTK updates, clipboard and voice, and typing into another
agent's terminal.

## Tool audit (2026-10-22)

Before the app tools merged, each of the 96 tools in `TOOL_REGISTRY` got one decision. **Keep**: supported
as is. **Change**: kept, with a follow-up named here. **Experimental**: may change or go without notice.
**Remove**: none this round.

| Group | Tools | Decision | Why / follow-up |
|---|---|---|---|
| App reads | `oxespace_git`, `oxespace_github`, `oxespace_threads`, `oxespace_tasks`, `oxespace_skills`, `oxespace_automations`, `oxespace_linear`, `oxespace_terminal`, `oxespace_mcp_servers`, `oxespace_usage` | Keep | One tool per domain, `read`, scoped to the caller's project. |
| App changes | `oxespace_git_change`, `oxespace_github_change`, `oxespace_threads_change`, `oxespace_tasks_change`, `oxespace_automations_change`, `oxespace_workspace_change`, `oxespace_mcp_servers_change` | Keep | Level per action; `confirm` where an effect leaves the machine or rewrites history. |
| Agents in panes | `oxespace_agents`, `oxespace_agents_change` | Experimental | New with the agent runtime (state from hooks and screen); the action set may change after field use. |
| Agent profiles for delegation | `oxespace_list_agents` | Change | Easy to confuse with `oxespace_agents`: its description must say it lists *profiles*, not running agents. |
| Thread handoff | `oxespace_thread_create`, `oxespace_thread_send`, `oxespace_thread_read` | Keep | Different policy from `oxespace_threads_change send`: only Threads this caller created, no question asked. Both stay; descriptions point to each other. |
| Delegation | `oxespace_delegate_task`, `oxespace_delegation_*` (12) | Keep | The delegation protocol; consolidating it with work plans is a cycle-D decision, not this one. |
| Work plans | `oxespace_work_plan`, `oxespace_work_status`, `oxespace_work_result`, `oxespace_work_message`, `oxespace_work_cancel` | Keep | Base of the self-development flow (cycle D1). |
| Teams | `oxespace_team_status`, `oxespace_team_inbox`, `oxespace_team_message`, `oxespace_team_acknowledge` | Keep | Membership and delivery fixed in 1.3.1. |
| Memory | `oxespace_memory_*` (6) | Experimental | AI Memory is an opt-in beta; the tools only exist when it is on. |
| Search | `oxespace_search`, `oxespace_code_search`, `oxespace_semantic_search`, `oxespace_hybrid_explore`, `oxespace_code_callers`, `oxespace_code_callees`, `oxespace_code_impact`, `oxespace_code_node`, `oxespace_code_status` | Change | Four ways to search overlap. Follow-up: measure which agents call (the local counters since 1.2.0) and fold the least used into `oxespace_hybrid_explore`, with the semantic-index decision of the roadmap. |
| OxeQuery | `oxespace_db_*` (6), `oxespace_mongo_*` (3), `oxespace_containers_list`, `oxespace_container_logs`, `oxespace_container_action` | Keep | Writes go through the OxeQuery broker and audit. |
| Workspace and scripts | `oxespace_list_workspaces`, `oxespace_list_panes`, `oxespace_list_worktrees`, `oxespace_create_worktree`, `oxespace_remove_worktree`, `oxespace_list_scripts`, `oxespace_run_script`, `oxespace_list_background_jobs`, `oxespace_stop_background_job`, `oxespace_get_job_output` | Keep | Predate the domain tools; folding them into `oxespace_workspace` / `oxespace_workspace_change` is a follow-up once callers move. |
| Web Preview | `oxespace_open_web_preview`, `oxespace_capture_web_preview`, `oxespace_preview_interact` | Keep | Scoped by `preview-scope.ts`. |
| Documentation | `oxespace_documentation_*` (7) | Keep | |
| Context | `oxespace_capabilities`, `oxespace_execution_context`, `oxespace_project_context`, `oxespace_quality_check` | Keep | |

96 tools is also a token cost on every turn, since each definition is sent to the model. The roadmap's
Code Mode option starts when tool definitions pass about 20% of a turn's tokens; the search and workspace
follow-ups above are the cheaper first step.

## Long tool results

A tool result with more than 32,000 characters of text is cut before it reaches the agent
(`electron/main/mcp-internal/tool-result-bound.ts`, applied to every tool in `local-rpc-server.ts`):

- It keeps the first 60% and the last 40% of the allowed length. A marker between them says how much was
  left out and names the file that holds the full text.
- Full texts go to `<userData>/tool-output/<tool>-<time>-<id>.txt`. The name never comes from the tool's
  arguments. Files older than seven days are deleted when the app starts.
- Image blocks are kept. The text blocks of a cut result become one block.
- A tool can set its own `outputLimit` in its registry entry.

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
