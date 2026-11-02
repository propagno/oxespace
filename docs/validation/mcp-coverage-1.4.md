# MCP coverage for 1.4 (X21)

Everything OXESpace offers is reachable as an internal MCP tool at the right level, or is excluded on
purpose with a reason. The source of truth is `shared/mcp-coverage.ts`; `tests/mcp-coverage.test.ts`
fails when:

- a registered tool, or an action of a domain tool, has no entry in the manifest;
- the manifest names a tool or action that does not exist, or a level the tool does not enforce
  (domain tools state their level per action);
- an IPC channel in `shared/types/ipc.ts` (`IPC_CHANNELS`) is claimed by no capability, or a manifest
  pattern matches no channel;
- a forbidden capability gains a tool, shares a channel with a covered capability, or a tool name,
  action or argument looks like an approval, access, sign-in, token, secret, credential or trust;
- container resources (P7) or OxePost (H8) get tools;
- a read-only Thread is offered a tool that is not `read`, or the core Thread group changes;
- a capability id is missing from this document.

Levels: **read** runs; **write** needs a live OXESpace execution (a Code pane or a Thread), is rate
limited and recorded in `agent_action_audit`; **confirm** is a write a person approves, seeing the exact
text. OxeQuery tools go through the OxeQuery gateway, with its own approvals and audit. The organization
policy (`tool.use` rules of the policy store) applies by tool name to every tool, new ones included.

## Counts

| Covered | Excluded | Planned | Forbidden | Total |
|---|---|---|---|---|
| 37 | 30 | 2 | 15 | 84 |

The registry has 89 tools: 66 single-purpose tools and 23 domain tools with 88 actions, so the
manifest declares 154 tool-or-action entries.

## Forbidden, never a tool

The standing rule: approvals or raising access, sign-in and tokens, secrets, MCP server trust.

| Capability | IPC it stands for |
|---|---|
| `thread.approvals` | `thread.approve`, `thread.respond`, `thread.pendingRequestsAll` |
| `thread.access` | Thread permission rules and auto-approval of reads |
| `delegation.authorize` | `delegation.configure`, `delegation.configureTarget`, `delegation.adopt` |
| `web_preview.access` | `browserPreview.setAccess` (external sites) |
| `git.repo_hook_approval` | `github.getRepoConfig`, `github.approveRepoHook` |
| `accounts.sign_in` | `agentAccount.*` |
| `linear.token` | `linear.setApiKey`, `linear.clearApiKey` |
| `mcp_internal.token` | `mcpInternal.regenerateToken` |
| `oxequery.secrets` | OxeQuery connection credentials, SSH host keys, connection export/import |
| `mcp.server_trust` | `mcp.create`, `update`, `delete`, `discover`, `importDiscovered`, `openSignIn` |
| `mcp_internal.tool_groups_admin` | `mcpInternal.setToolGroupMode` |
| `remote.gateway_admin` | `remote.setEnabled`, `startPairing`, `cancelPairing`, `answerPairing`, `revoke`, `rename`, `setDesktopName`, `setPhoneWrite` |
| `approvals.admin` | `approvals.list`, `respond`, `ack`, `unavailable`, `history` (B10: the app's own approval modal) |
| `thread.sections` | `thread.sections`, `thread.saveSections` (F13, for 1.4: the person's own organization of the conversation list) |
| `app.open_external` | `app.openExternal` (the window's only way to open a link outside the app, after the person confirmed its host) |
| `app.activity` | `activity.recent`, `activity.record`, `activity.seen`, `activity.resolve` (F30, for 1.4: the person's own notification history) |
| `mcp.tool_rules_admin` | `mcpInternal.setToolRule` |
| `policy.accept_change` | `policy.acceptChange`, `policy.reviewChange` (B7.4: accepting, or reviewing again, a policy file changed outside OXESpace; the phone maps a `policyChange` request to its forbidden `policy.edit`) |

### Per-tool rules (B7.3): where each one holds

Settings › Tools sets, per MCP tool of a project, `allow`, `ask` or `deny` (`electron/main/services/mcp-tool-rules.ts`).

- **`deny`** is `{ "effect": "deny", "action": "tool.use", "resource": "mcp__<server>__<tool>" }` in the project's
  `.oxespace/policy.json`. It holds everywhere: OxeChat hides the tool at launch (Claude `--disallowedTools`, Codex
  `disabled_tools` for the servers OXESpace attaches) and declines its approvals; the internal MCP server refuses
  `tools/call` for an OXESpace tool (`mcp__oxespace-delegation__<tool>`) whatever key the caller's CLI uses, which covers
  agents in OxeCode terminals.
- **`allow`** is a project permission rule (`tool`, `<server>/<tool>`). It answers OxeChat approvals only. Agents in
  OxeCode terminals keep following their own CLI's permissions (`.claude/settings*.json`, Codex approval policy); OXESpace
  does not write those. An OXESpace tool with any action of the `confirm` level cannot be allowed
  (`mcp.toolRule.confirmLevel`): it asks the person every time.
- **`ask`** removes both. Rules from the user or managed policy, and permission rules saved for all projects, are shown
  as not editable (`mcp.toolRule.locked`) and never written.

## New in X21

| Tool / action | Level | Thread group | What it reads or does |
|---|---|---|---|
| `oxespace_settings#workspace` | read | app | The Code workspace's settings (name, root, layout, default shell, auto start, pane count). |
| `oxespace_settings#policy` | read | app | Organization policy in force for the project (layers, rules, problems). |
| `oxespace_settings#semantic` | read | app | Semantic index status of the project (no last query text). |
| `oxespace_integration#groups` | read | Code only | Integration groups the workspace belongs to, with members. |
| `oxespace_integration#handoffs` | read | Code only | Handoffs of one of those groups; other groups are refused. |
| `oxespace_threads#native_sessions` | read | app | Claude Code / Codex CLI sessions of the folder (no transcript path). |
| `oxespace_git#checkpoints` | read | app | Checkpoints of the work tree, so `restore_checkpoint` has its ids (no patch body). |
| `oxespace_git_change#delete_checkpoint` | confirm | app | Delete one checkpoint of this workspace. |

Existing tools now behind the same policy door as domain tools (they predate it and ran unchecked):
`oxespace_create_worktree`, `oxespace_run_script` and `oxespace_stop_background_job` are **write**;
`oxespace_remove_worktree` is **confirm** (it deletes the folder with its untracked and ignored files).
A caller without a live execution gets `no-execution` instead of the effect.

`oxespace_open_web_preview` (B15) is **confirm**, and the level depends on the URL. http(s) to `localhost`,
`*.localhost`, `127.0.0.1` or `[::1]`, on any port, skips the question and runs as **write**, as before. Any other
host waits for a person to approve that exact URL; nothing is queued for the preview until then. Every other scheme
(`file:`, `javascript:`, `data:`, `blob:`, `about:`, `chrome:`, `devtools:`, `mailto:`, custom ones) is refused
without asking. `file:` stays refused in 1.4 because the preview loads http(s) only, so an approval could not lead
anywhere; opening a file after an approval is a post-1.4 item. The host must be written the way the URL parser writes it: `http://2130706433`, `http://0177.0.0.1`,
`http://LOCALHOST`, `http://[::ffff:7f00:1]`, `http://localhost.evil.com` and `http://127.0.0.1@evil.com` all ask
(`electron/main/utils/preview-url.ts`).

None of these is in the core Thread group, so an ordinary Thread sends the same tool definitions as
before. Code panes receive the whole registry.

## Capabilities

| Id | Capability | MCP tools by level, or the decision |
|---|---|---|
| `context.discovery` | Discover tools, the caller's execution and the project context | **read**: `oxespace_capabilities`, `oxespace_tools_enable`, `oxespace_execution_context`, `oxespace_project_context` |
| `code.workspaces` | List workspaces | **read**: `oxespace_list_workspaces` |
| `code.workspace_settings` | Read the workspace's settings | **read**: `oxespace_settings#workspace` |
| `code.workspace_admin` | Create, delete, reorder or switch workspaces; change their settings and panel layout | Excluded: The person's layout and preferences. Deleting a workspace is never exposed. |
| `code.panes` | Panes, and agents started in panes | **read**: `oxespace_list_panes`<br>**write**: `oxespace_agents_change#start`<br>**confirm**: `oxespace_agents_change#close_pane` |
| `code.agents` | Agents running in panes: state, output, prompt, stop a turn | **read**: `oxespace_agents#list`, `oxespace_agents#read`, `oxespace_agents#explain`, `oxespace_agents#wait`<br>**confirm**: `oxespace_agents_change#prompt`, `oxespace_agents_change#interrupt` |
| `code.activity` | Activity center (the title-bar bell) | Excluded: A window-only list of the person's notifications. The states behind it are read with oxespace_agents list and oxespace_threads list. |
| `code.agent_seen` | Mark an agent's finished turn as seen | Excluded: An attention marker of the person's window. |
| `code.terminal_output` | Read a pane's output | **read**: `oxespace_terminal#output` |
| `code.terminal_input` | Start, type into, resize or stop a terminal | Excluded: Free key input into another terminal. Agents prompt agents with oxespace_agents_change prompt, which refuses one waiting for an approval. |
| `code.agent_profiles` | Agent profiles an agent can delegate to | **read**: `oxespace_list_agents` |
| `code.agent_profiles_admin` | Create, edit, delete or discover agent profiles | Excluded: A profile chooses an executable and arguments that run on this machine; the person edits it. |
| `code.scripts` | Project scripts | **read**: `oxespace_list_scripts`<br>**write**: `oxespace_run_script` |
| `code.background_jobs` | Background jobs | **read**: `oxespace_list_background_jobs`, `oxespace_get_job_output`<br>**write**: `oxespace_stop_background_job` |
| `code.background_cleanup` | Remove a finished job from the list | Excluded: Tidies the person's list; nothing for an agent to gain. |
| `code.worktrees` | Git worktrees | **read**: `oxespace_list_worktrees`<br>**write**: `oxespace_create_worktree`, `oxespace_workspace_change#worktree_for_linear_issue`<br>**confirm**: `oxespace_remove_worktree` |
| `code.worktree_cleanup` | Bulk worktree cleanup | Excluded: Deletes many worktrees at once. Agents remove one at a time, approved by a person. |
| `code.tasks` | Task board | **read**: `oxespace_tasks#list`, `oxespace_tasks#ready`, `oxespace_tasks#executions`<br>**write**: `oxespace_tasks_change#create`, `oxespace_tasks_change#update`, `oxespace_tasks_change#reorder`, `oxespace_tasks_change#add_dependency`, `oxespace_tasks_change#remove_dependency`<br>**confirm**: `oxespace_tasks_change#verify`, `oxespace_tasks_change#delete` |
| `code.task_run` | Start a task in an agent's terminal | Excluded: Types the task into another agent's terminal. |
| `code.integration` | Integration groups and their handoffs | **read**: `oxespace_integration#groups`, `oxespace_integration#handoffs` |
| `code.integration_admin` | Edit integration groups, members and handoffs | Excluded: The person's coordination plan. Agents hand work over with Team, delegation or memory handoffs. |
| `code.oxe_workflow` | OXE workflow state and dashboard | Excluded: The state is in .oxe/ files the agent reads itself; the dashboard is a window for the person. |
| `code.notifications` | Desktop notification | **write**: `oxespace_workspace_change#notify` |
| `code.local_input` | Clipboard and voice | Excluded: The person's own input devices. |
| `web_preview.use` | Open, drive and capture the Web Preview | **read**: `oxespace_capture_web_preview`<br>**write**: `oxespace_preview_interact`<br>**confirm**: `oxespace_open_web_preview` (a local http(s) URL runs as write; see below) |
| `web_preview.access` | Let the preview reach external sites | **Forbidden**: Raises access. |
| `git.read` | Status, branch, diffs, files at a ref, checkpoints | **read**: `oxespace_git#status`, `oxespace_git#branch`, `oxespace_git#diff_summary`, `oxespace_git#diff`, `oxespace_git#file_at_ref`, `oxespace_git#checkpoints` |
| `git.change` | Stage, commit, branch, fetch, pull, push, checkpoints | **write**: `oxespace_git_change#stage`, `oxespace_git_change#stage_all`, `oxespace_git_change#unstage`, `oxespace_git_change#commit`, `oxespace_git_change#create_branch`, `oxespace_git_change#fetch`, `oxespace_git_change#pull`, `oxespace_git_change#create_checkpoint`<br>**confirm**: `oxespace_git_change#checkout`, `oxespace_git_change#push`, `oxespace_git_change#restore_checkpoint`, `oxespace_git_change#delete_checkpoint` |
| `git.commit_message` | Generate a commit message | Excluded: Asks an AI provider on the person's behalf; an agent writes its own message. |
| `git.repo_hook_approval` | Approve a repository hook | **Forbidden**: An approval: it lets the repository's commands run. |
| `github.read` | Pull requests, CI runs and logs, commits, releases | **read**: `oxespace_github#status`, `oxespace_github#branches`, `oxespace_github#pull_requests`, `oxespace_github#pull_request_status`, `oxespace_github#commits`, `oxespace_github#commit`, `oxespace_github#releases`, `oxespace_github#workflows`, `oxespace_github#runs`, `oxespace_github#run`, `oxespace_github#run_logs` |
| `github.change` | Open pull requests, auto-merge, releases, run workflows | **confirm**: `oxespace_github_change#create_pull_request`, `oxespace_github_change#set_auto_merge`, `oxespace_github_change#create_release`, `oxespace_github_change#run_workflow`, `oxespace_github_change#rerun` |
| `github.connected_repositories` | Connect a GitHub repository to a workspace | Excluded: An account-level link the person makes and confirms in the GitHub panel. |
| `search.text` | Exact text search and the file list | **read**: `oxespace_search#text`, `oxespace_search#files` |
| `search.code` | Semantic, structural and hybrid code retrieval; post-diff quality check | **read**: `oxespace_semantic_search`, `oxespace_hybrid_explore`, `oxespace_quality_check`, `oxespace_code_search`, `oxespace_code_callers`, `oxespace_code_callees`, `oxespace_code_impact`, `oxespace_code_node`, `oxespace_code_status`, `oxespace_settings#semantic`<br>**write**: `oxespace_workspace_change#reindex` |
| `search.semantic_admin` | Turn semantic search on or off; download, import or remove the vector model | Excluded: Changes disk use and what is indexed; the person decides in Settings. |
| `editor.files` | Read, write and watch files in the editor | Excluded: Agents read and edit files with their own tools, under their provider's permission prompts; an MCP write would bypass them. Reads: oxespace_git file_at_ref, oxespace_search. |
| `thread.read` | List and read Threads, their usage, and CLI sessions of the folder | **read**: `oxespace_threads#list`, `oxespace_threads#read`, `oxespace_threads#usage`, `oxespace_threads#native_sessions`, `oxespace_thread_read` |
| `thread.drive` | Create Threads, send, steer, stop, set the model, rename, archive | **write**: `oxespace_thread_create`, `oxespace_thread_send`<br>**confirm**: `oxespace_threads_change#send`, `oxespace_threads_change#steer`, `oxespace_threads_change#interrupt`, `oxespace_threads_change#configure`, `oxespace_threads_change#rename`, `oxespace_threads_change#archive` |
| `thread.history_edit` | Rewind, undo a turn's edits, export, import, recover, attach files, slash commands | Excluded: Rewrites or acts inside another conversation's session; the person does it. Agents drive Threads with send and steer. |
| `thread.project_admin` | Add, relink or hide Thread projects; idle suspension; shell check | Excluded: The person's settings. |
| `thread.sections` | Sections of the conversation list (F13) | **Forbidden**: For 1.4, how the person organizes their own list: an agent neither reads nor rearranges it. |
| `thread.approvals` | Answer a Thread's approvals and questions | **Forbidden**: Approvals stay with the person. |
| `thread.side_chat` | A side chat about a conversation | Excluded: The person's read-only scratch copy of a conversation; agents ask in their own. |
| `thread.access` | Permission rules and auto-approval | **Forbidden**: Raises access. |
| `thread.session_admin` | Fork, delete, clean up or search CLI sessions | Excluded: Deletes or copies the person's CLI history across projects. Agents search with oxespace_memory_search, scoped to the project. |
| `team.messaging` | Team status and messages | **read**: `oxespace_team_status`, `oxespace_team_inbox`<br>**write**: `oxespace_team_message`, `oxespace_team_acknowledge` |
| `team.admin` | Add members, pick the coordinator, archive, delivery | Excluded: The person builds the team. |
| `delegation.use` | Delegate a task and follow it | **read**: `oxespace_delegation_targets`, `oxespace_delegation_preflight`, `oxespace_delegation_status`, `oxespace_delegation_inbox`, `oxespace_delegation_result`, `oxespace_delegation_context`<br>**write**: `oxespace_delegate_task`, `oxespace_delegation_control`, `oxespace_delegation_update`, `oxespace_delegation_checkpoint`, `oxespace_delegation_message`, `oxespace_delegation_acknowledge` |
| `delegation.authorize` | Authorize delegation targets and adopt delegations | **Forbidden**: Raises access: decides where agents may start work. |
| `work.plans` | Work plans: plan, status, result, message, cancel | **read**: `oxespace_work_status`, `oxespace_work_result`<br>**write**: `oxespace_work_plan`, `oxespace_work_message`, `oxespace_work_cancel` |
| `memory.use` | Project memory: search, remember, sessions, handoffs | **read**: `oxespace_memory_search`, `oxespace_memory_sessions`, `oxespace_memory_handoffs`, `oxespace_memory_diagnostics`<br>**write**: `oxespace_memory_remember`, `oxespace_memory_accept_handoff` |
| `memory.admin` | Install, configure or roll back memory; wire it into agents | Excluded: Memory is the person's opt-in. |
| `documentation.use` | Documentation captures and exports | **read**: `oxespace_documentation_list`, `oxespace_documentation_get`<br>**write**: `oxespace_documentation_create`, `oxespace_documentation_checkpoint`, `oxespace_documentation_capture`, `oxespace_documentation_image`, `oxespace_documentation_export` |
| `oxequery.read` | Connections, schemas, read queries, plans, activity | **read**: `oxespace_db_connections`, `oxespace_db_describe`, `oxespace_db_explain`, `oxespace_db_activity`<br>**confirm**: `oxespace_db_query`, `oxespace_mongo_find`, `oxespace_mongo_aggregate` |
| `oxequery.write` | Change data or schema | **confirm**: `oxespace_db_execute`, `oxespace_mongo_write` |
| `oxequery.saved_queries` | Saved queries, history, import and export of data | Excluded: The person's notebook and bulk data moves; agents run one approved statement at a time. |
| `oxequery.secrets` | Connection credentials, SSH host keys, export and import of connections | **Forbidden**: Secrets and trust. |
| `containers.runtime` | Containers (OxePod): list, logs, start, stop, restart | **read**: `oxespace_containers_list`, `oxespace_container_logs`<br>**confirm**: `oxespace_container_action` |
| `containers.resources` | Images, volumes, networks, compose, exec and shell, stats, database containers | Planned (P7): OxePod shows them to the person; tools for them come with P7. Removing a container and cleaning up are the person's confirmed actions in OxePod and are not tools. A container's environment reaches the page redacted and never an agent. |
| `skills.use` | Skills: list, read, add | **read**: `oxespace_skills#list`, `oxespace_skills#get`<br>**confirm**: `oxespace_skills_change#create` |
| `skills.invoke` | Invoke a skill in a pane | Excluded: Types the skill into a terminal. Agents read its body with oxespace_skills get. |
| `automations.use` | Scheduled automations | **read**: `oxespace_automations#list`, `oxespace_automations#runs`<br>**write**: `oxespace_automations_change#disable`<br>**confirm**: `oxespace_automations_change#create`, `oxespace_automations_change#enable`, `oxespace_automations_change#run_now`, `oxespace_automations_change#remove` |
| `mcp.servers` | MCP servers: list, health, start, stop | **read**: `oxespace_mcp_servers#list`<br>**write**: `oxespace_mcp_servers_change#stop`<br>**confirm**: `oxespace_mcp_servers_change#start` |
| `mcp.server_trust` | Add, edit, import, trust (also again after a quarantine) or sign in to MCP servers | **Forbidden**: MCP server trust, including trusting a quarantined server again; commands, environment and headers carry secrets. An agent can only read that a server is quarantined (oxespace_mcp_servers#list). |
| `mcp.call_tool` | Call another server's tool from the app | Excluded: Agents reach those servers through their own MCP client, as the person trusted them. |
| `linear.read` | Linear issues | **read**: `oxespace_linear#status`, `oxespace_linear#teams`, `oxespace_linear#issues`, `oxespace_linear#issue` |
| `linear.token` | Linear API key | **Forbidden**: A token. |
| `usage.read` | Context window and plan allowance | **read**: `oxespace_usage#context`, `oxespace_usage#credits` |
| `usage.copilot` | GitHub Copilot allowance | Excluded: No agent OXESpace starts runs on Copilot; the panel is for Copilot panes. |
| `settings.policy` | Organization policy in force | **read**: `oxespace_settings#policy` |
| `settings.app` | Appearance, UI scale, app updates, RTK, agent hooks | Excluded: The person's app maintenance; installing hooks writes into the agents' own configuration. |
| `app.open_external` | Open a link in the system browser or mail app | **Forbidden**: Person-only, like an approval: the window calls it after the person confirmed the link's host. |
| `app.activity` | The activity center's entries and when the person last looked at them (F30) | **Forbidden**: For 1.4, the person's own notification history: an agent neither reads it nor writes into it. |
| `mcp_internal.tool_groups_admin` | Choose how a project offers each group of OXESpace tools | **Forbidden**: Raises what agents can reach. |
| `settings.diagnostics` | Diagnostics snapshot, live measurements, problem bundles and reports | Excluded: Whole-app paths and logs, and measuring only while the panel is open; the person exports or clears them. |
| `diagnostics.read` | Summary of the incident journal and a snapshot of the app | **read**: `oxespace_diagnostics` (app group): the same Markdown summary as the window's "Ask for an analysis". |
| `remote.devices_read` | Remote gateway status and paired phones | Excluded: The person's devices, shown in Settings › Devices; agents have no use for them. |
| `remote.gateway_admin` | Turn the remote gateway on or off, pair, answer, revoke or rename a phone, name the desktop, let a phone type into a pane | **Forbidden**: Opens a network surface and grants device access. |
| `mcp.tool_rules_admin` | Choose, per MCP tool, to run it without asking, ask, or block it | **Forbidden**: Approvals and access stay with the person. |
| `settings.agent_audit` | Audit of agent actions; internal MCP status | Excluded: The person's review of what agents did. OxeQuery's trail is oxespace_db_activity. |
| `mcp_internal.token` | Regenerate the internal MCP token | **Forbidden**: A token. |
| `accounts.sign_in` | Sign in or out of Claude, Codex and other accounts | **Forbidden**: Sign-in and tokens. |
| `app.events` | Change notifications sent to the window | Excluded: Events, not actions: agents read the state they describe with the tools above. |
| `oxepost.all` | OxePost: collections, environments, sending | Planned (H8): OxePost (H1-H4) is the person's API client: collections, environments and sending have no tool yet; H8 adds list, read and create, and send with GET and HEAD to localhost free and the rest confirmed. Environment secrets stay in the system's secure storage and are never a tool, an argument or a result. |
