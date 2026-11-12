/**
 * What OXESpace offers, and how an agent reaches it over the internal MCP server.
 *
 * Every capability is one of:
 *   tools      reachable: each tool, or each action of a domain tool (`oxespace_git#status`), with its level
 *   excluded   deliberately not a tool, with the reason
 *   planned    belongs to a future item (P7 OxePod containers, H8 OxePost)
 *   forbidden  never a tool: approvals or raising access, sign-in and tokens, secrets, MCP server trust
 *
 * `ipc` names the app's IPC channels (`group.key` from IPC_CHANNELS, `*` as a wildcard) the capability
 * stands for. tests/mcp-coverage.test.ts fails when a registered tool, a domain action or an IPC channel
 * has no entry here, when an entry names a tool that does not exist or has another level, and when a
 * forbidden capability becomes reachable. docs/validation/mcp-coverage-1.4.md is the readable form.
 */
export type McpLevel = 'read' | 'write' | 'confirm'

interface Base { label: string; ipc?: readonly string[] }
export type McpCapability =
  | Base & { tools: Readonly<Record<string, McpLevel>> }
  | Base & { excluded: string }
  | Base & { planned: 'P7' | 'H8'; reason: string }
  | Base & { forbidden: string }

/** The user's standing rule: these never become MCP tools. Each must be a `forbidden` capability. */
export const FORBIDDEN_CAPABILITIES = ['thread.approvals', 'thread.access', 'accounts.sign_in', 'mcp_internal.token', 'oxequery.secrets', 'mcp.server_trust', 'delegation.authorize', 'web_preview.access', 'android.controls', 'git.repo_hook_approval', 'remote.gateway_admin', 'approvals.admin', 'mcp_internal.tool_groups_admin', 'app.open_external', 'mcp.tool_rules_admin', 'policy.accept_change', 'app.open_in', 'code.resume_bypass', 'containers.panel', 'settings.feature_usage', 'settings.hosts_proxy'] as const

/** No tool name or domain action may look like one of these. */
export const FORBIDDEN_NAME = /approv|permission|access|sign_?in|log_?in|log_?out|token|secret|credential|password|api_?key|trust|host_?key/i
/** No argument may be one of these: the level comes from the tool, never from the model. */
export const FORBIDDEN_ARGUMENT = /^(access|approved?|approval|confirmed|token|api_?key|password|secret|trusted|credentials?)$/i

function each(tool: string, level: McpLevel, actions: readonly string[]): Record<string, McpLevel> {
  return Object.fromEntries(actions.map(action => [`${tool}#${action}`, level]))
}

export const MCP_COVERAGE: Readonly<Record<string, McpCapability>> = {
  // ---- context ----------------------------------------------------------------
  'context.discovery': {
    label: 'Discover tools, the caller\'s execution and the project context',
    tools: { oxespace_capabilities: 'read', oxespace_tools_enable: 'read', oxespace_execution_context: 'read', oxespace_project_context: 'read' },
    ipc: ['oxeContext.buildPaneManifest']
  },

  // ---- Code: workspaces, panes, terminals --------------------------------------
  'code.workspaces': { label: 'List workspaces', tools: { oxespace_list_workspaces: 'read' }, ipc: ['workspace.list'] },
  'code.workspace_settings': {
    label: 'Read the workspace\'s settings',
    tools: each('oxespace_settings', 'read', ['workspace'])
  },
  'code.workspace_admin': {
    label: 'Create, delete, reorder or switch workspaces; change their settings and panel layout',
    excluded: 'The person\'s layout and preferences. Deleting a workspace is never exposed.',
    ipc: ['workspace.create', 'workspace.setActive', 'workspace.delete', 'workspace.reorder', 'workspace.pickFolder', 'workspace.updateSettings', 'workspace.shellProfiles',
      'workspace.update*State', 'workspace.splitPane', 'workspace.updatePaneType', 'workspace.updatePaneName', 'workspace.setPaneRootPath', 'workspace.createGitHubTerminalPane']
  },
  'code.panes': {
    label: 'Panes, and agents started in panes',
    tools: { oxespace_list_panes: 'read', ...each('oxespace_agents_change', 'write', ['start']), ...each('oxespace_agents_change', 'confirm', ['close_pane']) },
    ipc: ['workspace.createPane', 'workspace.closePane', 'workspace.setPaneAgent']
  },
  'code.agents': {
    label: 'Agents running in panes: state, output, prompt, stop a turn',
    tools: { ...each('oxespace_agents', 'read', ['list', 'read', 'explain', 'wait']), ...each('oxespace_agents_change', 'confirm', ['prompt', 'interrupt']) },
    ipc: ['agentState.list', 'agentState.explain']
  },
  'code.activity': {
    label: 'Activity center (the title-bar bell)',
    excluded: 'A window-only list of the person\'s notifications. The states behind it are read with oxespace_agents list and oxespace_threads list.'
  },
  'code.agent_seen': { label: 'Mark an agent\'s finished turn as seen', excluded: 'An attention marker of the person\'s window.', ipc: ['agentState.markSeen'] },
  'code.agents_overview': { label: 'The agents overview and what the person has seen (agents:overview, agents:mark-seen, agents:changed)', forbidden: 'The person\'s overview of every agent; only the person marks what they have seen. Agents read the same states with oxespace_agents list, oxespace_threads list and oxespace_work status.', ipc: ['agents.*'] },
  'code.terminal_output': { label: 'Read a pane\'s output', tools: each('oxespace_terminal', 'read', ['output']), ipc: ['terminal.status'] },
  'code.terminal_input': {
    label: 'Start, type into, resize or stop a terminal',
    excluded: 'Free key input into another terminal. Agents prompt agents with oxespace_agents_change prompt, which refuses one waiting for an approval.',
    ipc: ['terminal.start', 'terminal.write', 'terminal.resize', 'terminal.stop', 'terminal.restart', 'terminal.attach', 'terminal.detach', 'terminal.sizeLease', 'terminal.takeBackSize', 'terminal.sizeLeaseChanged']
  },
  'code.pane_branch': {
    label: 'A pane\'s branch and the branch it started on (switched from)',
    excluded: 'The person\'s pane header. Agents read the branch with oxespace_git branch.',
    ipc: ['terminal.branch', 'terminal.branchChanged']
  },
  'code.agent_profiles': {
    label: 'Agent profiles an agent can delegate to',
    tools: { oxespace_list_agents: 'read' },
    ipc: ['agent.list', 'agent.getReadiness', 'agent.compatibility']
  },
  'code.agent_profiles_admin': {
    label: 'Create, edit, delete or discover agent profiles',
    excluded: 'A profile chooses an executable and arguments that run on this machine; the person edits it.',
    ipc: ['agent.create', 'agent.update', 'agent.delete', 'agent.discover']
  },
  'code.scripts': { label: 'Project scripts', tools: { oxespace_list_scripts: 'read', oxespace_run_script: 'write' } },
  'code.background_jobs': {
    label: 'Background jobs',
    tools: { oxespace_list_background_jobs: 'read', oxespace_get_job_output: 'read', oxespace_stop_background_job: 'write' },
    ipc: ['background.list', 'background.getOutput', 'background.start', 'background.stop']
  },
  'code.background_cleanup': { label: 'Remove a finished job from the list', excluded: 'Tidies the person\'s list; nothing for an agent to gain.', ipc: ['background.remove'] },
  'code.worktrees': {
    label: 'Git worktrees',
    tools: { oxespace_list_worktrees: 'read', oxespace_create_worktree: 'write', oxespace_remove_worktree: 'confirm' },
    ipc: ['github.listWorktrees', 'github.createWorktree', 'github.removeWorktree', 'github.resolveWorktreeBase', 'github.getWorktreeStatus']
  },
  'code.worktrees_panel': {
    label: 'The Worktrees panel: list with owner, merged state, disk use and activity, and guarded Remove with optional local branch delete (A63)',
    excluded: 'The person\'s window and local branch delete. Agents list and remove worktrees one at a time without deleting branches (oxespace_list_worktrees, oxespace_remove_worktree).',
    ipc: ['worktreesPanel.list', 'worktreesPanel.remove']
  },
  'code.worktree_cleanup': {
    label: 'Bulk worktree cleanup',
    excluded: 'Deletes many worktrees at once. Agents remove one at a time, approved by a person.',
    ipc: ['github.scanWorktreeCleanup', 'github.removeWorktreeCleanup']
  },
  'code.tasks': {
    label: 'Task board',
    tools: {
      ...each('oxespace_tasks', 'read', ['list', 'ready', 'executions']),
      ...each('oxespace_tasks_change', 'write', ['create', 'update', 'reorder', 'add_dependency', 'remove_dependency']),
      ...each('oxespace_tasks_change', 'confirm', ['verify', 'delete'])
    },
    ipc: ['tasks.list', 'tasks.getReady', 'tasks.executions', 'tasks.create', 'tasks.update', 'tasks.reorder', 'tasks.addDependency', 'tasks.removeDependency', 'tasks.verify', 'tasks.delete']
  },
  'code.task_run': { label: 'Start a task in an agent\'s terminal', excluded: 'Types the task into another agent\'s terminal.', ipc: ['tasks.run'] },
  'code.integration': {
    label: 'Integration groups and their handoffs',
    tools: each('oxespace_integration', 'read', ['groups', 'handoffs']),
    ipc: ['integration.listGroups', 'integration.listHandoffs', 'integration.buildContext']
  },
  'code.integration_admin': {
    label: 'Edit integration groups, members and handoffs',
    excluded: 'The person\'s coordination plan. Agents hand work over with Team, delegation or memory handoffs.',
    ipc: ['integration.createGroup', 'integration.updateGroup', 'integration.deleteGroup', 'integration.addMember', 'integration.updateMember', 'integration.removeMember',
      'integration.attachSession', 'integration.createHandoff', 'integration.updateHandoff']
  },
  'code.oxe_workflow': {
    label: 'OXE workflow state and dashboard',
    excluded: 'The state is in .oxe/ files the agent reads itself; the dashboard is a window for the person.',
    ipc: ['oxe.*']
  },
  'code.notifications': { label: 'Desktop notification', tools: each('oxespace_workspace_change', 'write', ['notify']), ipc: ['notifications.notify'] },
  'code.local_input': {
    label: 'Clipboard',
    excluded: 'The person\'s own input devices.',
    ipc: ['clipboard.*', 'browserPreview.captureClipboard']
  },

  // ---- Web Preview --------------------------------------------------------------
  'web_preview.use': {
    label: 'Open, drive and capture the Web Preview',
    // B15: open_web_preview is confirm, and a local http(s) URL (localhost, *.localhost, 127.0.0.1, [::1], any port,
    // written plainly) skips the question and runs as write. Any other host asks first; other schemes, file: included, are refused.
    tools: { oxespace_open_web_preview: 'confirm', oxespace_preview_interact: 'write', oxespace_capture_web_preview: 'read' },
    ipc: ['browserPreview.session', 'browserPreview.mount', 'browserPreview.bounds', 'browserPreview.designMode', 'browserPreview.setZoom', 'browserPreview.reload',
      'browserPreview.back', 'browserPreview.forward', 'browserPreview.captureElement', 'browserPreview.captureElementFile', 'browserPreview.close', 'browserPreview.setDevice', 'mcpInternal.captureWebPreview']
  },
  'web_preview.access': { label: 'Let the preview reach external sites or end an agent browser grant', forbidden: 'Raises or revokes person-controlled access.', ipc: ['browserPreview.setAccess', 'browserPreview.revokeGrant'] },
  'android.screenshot': {
    label: 'Capture a screenshot of an Android device when Agents can see is on',
    tools: { oxespace_device_screenshot: 'read' }
  },
  'android.controls': {
    label: 'Android mirror window controls, input and the Agents can see switch',
    forbidden: 'The person\'s Android mirror, input and device access switch; no MCP tool may send input to a device or raise access.',
    ipc: ['android.*']
  },
  'code.resume_bypass': { label: 'Resume Claude sessions that skipped permissions that way', forbidden: 'Raises access: only the person turns it on.', ipc: ['terminal.resumeBypass', 'terminal.setResumeBypass'] },

  // ---- changes and Git ------------------------------------------------------------
  'git.read': {
    label: 'Status, branch, diffs, files at a ref, checkpoints',
    tools: each('oxespace_git', 'read', ['status', 'branch', 'diff_summary', 'diff', 'file_at_ref', 'checkpoints']),
    ipc: ['git.getBranch', 'git.getStatus', 'git.getDiff', 'git.getDiffSummary', 'git.getFileOriginal', 'git.getFileAtRef', 'github.listCheckpoints', 'thread.projectDiff']
  },
  'git.change': {
    label: 'Stage, commit, branch, fetch, pull, push, checkpoints',
    tools: {
      ...each('oxespace_git_change', 'write', ['stage', 'stage_all', 'unstage', 'commit', 'create_branch', 'create_checkpoint']),
      ...each('oxespace_git_change', 'confirm', ['fetch', 'pull', 'checkout', 'push', 'restore_checkpoint', 'delete_checkpoint'])
    },
    ipc: ['github.fetch', 'github.pullFfOnly', 'github.stageAll', 'github.stageFile', 'github.unstageFile', 'github.commit', 'github.push', 'github.commitAndPush',
      'github.createBranch', 'github.checkoutBranch', 'github.createCheckpoint', 'github.restoreCheckpoint', 'github.deleteCheckpoint']
  },
  'git.commit_message': { label: 'Generate a commit message', excluded: 'Asks an AI provider on the person\'s behalf; an agent writes its own message.', ipc: ['github.generateCommitMessage'] },
  'git.repo_hook_approval': { label: 'Approve a repository hook', forbidden: 'An approval: it lets the repository\'s commands run.', ipc: ['github.getRepoConfig', 'github.approveRepoHook'] },

  // ---- GitHub ---------------------------------------------------------------------
  'github.read': {
    label: 'Pull requests, CI runs and logs, commits, releases',
    tools: each('oxespace_github', 'read', ['status', 'branches', 'pull_requests', 'pull_request_status', 'commits', 'commit', 'releases', 'workflows', 'runs', 'run', 'run_logs']),
    ipc: ['github.getCliStatus', 'github.getWorkspaceStatus', 'github.listBranches', 'github.listPullRequests', 'github.getPullRequestStatus', 'github.listCommits',
      'github.getCommitDetails', 'github.listReleases', 'github.listWorkflows', 'github.listWorkflowRuns', 'github.getWorkflowRunDetails', 'github.getRunLogs']
  },
  'github.change': {
    label: 'Open pull requests, auto-merge, releases, run workflows',
    tools: each('oxespace_github_change', 'confirm', ['create_pull_request', 'set_auto_merge', 'create_release', 'run_workflow', 'rerun']),
    ipc: ['github.createPullRequest', 'github.setPullRequestAutoMerge', 'github.createRelease', 'github.runWorkflow', 'github.rerunRun']
  },
  'github.connected_repositories': {
    label: 'Connect a GitHub repository to a workspace',
    excluded: 'An account-level link the person makes and confirms in the GitHub panel.',
    ipc: ['github.listConnectedRepositories', 'github.connectRepository']
  },
  'code.pull_request': {
    label: 'The Pull request tab: a branch\'s pull request on GitHub or Azure DevOps',
    excluded: 'The person\'s window. Agents read pull requests with oxespace_github.',
    ipc: ['pullRequest.state']
  },

  // ---- search ---------------------------------------------------------------------
  'search.text': { label: 'Exact text search and the file list', tools: each('oxespace_search', 'read', ['text', 'files']), ipc: ['search.run', 'search.cancel', 'search.listFiles'] },
  'search.code': {
    label: 'The post-diff quality check',
    tools: { oxespace_quality_check: 'read' }
  },

  // ---- editor ---------------------------------------------------------------------
  'editor.files': {
    label: 'Read, write and watch files in the editor',
    excluded: 'Agents read and edit files with their own tools, under their provider\'s permission prompts; an MCP write would bypass them. Reads: oxespace_git file_at_ref, oxespace_search.',
    ipc: ['fs.*']
  },

  // ---- Threads ----------------------------------------------------------------------
  'thread.read': {
    label: 'List and read Threads, their usage, and CLI sessions of the folder',
    tools: { ...each('oxespace_threads', 'read', ['list', 'read', 'usage', 'native_sessions']), oxespace_thread_read: 'read' },
    ipc: ['thread.list', 'thread.read', 'thread.history', 'thread.readSince', 'thread.usageSummary', 'thread.contextUsage', 'thread.projects', 'thread.turnFiles',
      'thread.turnFileHunks', 'thread.artifact', 'thread.models', 'thread.commands', 'session.list']
  },
  'thread.side_chat': { label: 'A side chat about a conversation', excluded: 'The person\'s read-only scratch copy of a conversation; agents ask in their own.', ipc: ['thread.sideOpen', 'thread.sideSend', 'thread.sideClose'] },
  'thread.drive': {
    label: 'Create Threads, send, steer, stop, set the model, rename, archive',
    tools: {
      ...each('oxespace_threads_change', 'confirm', ['send', 'steer', 'interrupt', 'configure', 'rename', 'archive']),
      oxespace_thread_create: 'write', oxespace_thread_send: 'write'
    },
    ipc: ['thread.create', 'thread.send', 'thread.steer', 'thread.interrupt', 'thread.stopTask', 'thread.configure', 'thread.pin', 'thread.keepAfterPr', 'thread.updateQueued', 'thread.deleteQueued',
      'thread.reorderQueued', 'thread.resumeQueue', 'thread.sendQueuedNow', 'thread.retryTurn', 'thread.steerQueued']
  },
  'thread.history_edit': {
    label: 'Undo a turn\'s edits, export, import, recover, attach files, slash commands',
    excluded: 'Rewrites or acts inside another conversation\'s session; the person does it. Agents drive Threads with send and steer.',
    ipc: ['thread.undoTurnFile', 'thread.undoTurnHunk', 'thread.exportPortable', 'thread.importPortable', 'thread.recover',
      'thread.attach', 'thread.removeAttachment', 'thread.command', 'thread.observe', 'thread.debugEvents', 'thread.worktreeInspect', 'thread.worktreeFinish']
  },
  'thread.project_admin': {
    label: 'Add, relink or hide Thread projects; idle suspension; shell check',
    excluded: 'The person\'s settings.',
    ipc: ['thread.addProject', 'thread.relinkProject', 'thread.setProjectHidden', 'thread.idleSuspendMinutes', 'thread.setIdleSuspendMinutes', 'thread.shellCheck']
  },
  'thread.sections': {
    label: 'Sections of the conversation list (F13)',
    forbidden: 'For 1.4, how the person organizes their own list: an agent neither reads nor rearranges it.',
    ipc: ['thread.sections', 'thread.saveSections']
  },
  'thread.approvals': {
    label: 'Answer a Thread\'s approvals and questions',
    forbidden: 'Approvals stay with the person.',
    ipc: ['thread.approve', 'thread.respond', 'thread.pendingRequestsAll', 'thread.respondPending']
  },
  'approvals.admin': {
    label: 'Answer, acknowledge, preview, Always-allow or list the app\'s approval requests and What agents can do',
    forbidden: 'Approvals and permissions stay with the person: an agent never answers, lists, previews, Always-allows or changes what agents can do.',
    ipc: ['approvals.list', 'approvals.respond', 'approvals.ack', 'approvals.unavailable', 'approvals.history', 'approvals.preview', 'approvals.alwaysAllow',
      'agentPermissions.list', 'agentPermissions.revokeRule', 'agentPermissions.setDatabaseAccess', 'agentPermissions.setHostAccess', 'agentPermissions.undo']
  },
  'thread.access': {
    label: 'Permission rules and auto-approval',
    forbidden: 'Raises access.',
    ipc: ['thread.permissionRules', 'thread.addPermissionRule', 'thread.removePermissionRule', 'thread.autoApproveReads', 'thread.setAutoApproveReads']
  },
  'thread.places': {
    label: 'A conversation\'s places, their diffs, path links, panes, collisions and agent summary (F4)',
    excluded: 'The person\'s window: read models of where a conversation worked. Agents read their own checkout with oxespace_git.',
    ipc: ['thread.places', 'thread.placeDiff', 'thread.resolvePath', 'thread.panes', 'thread.collisions', 'thread.agentSummary', 'thread.placesChanged']
  },
  'thread.cockpit': {
    label: 'A conversation\'s tool tabs and background shells (F6)',
    excluded: 'The person\'s window: read models of what a conversation used and left running. Agents see their own tools and shells.',
    ipc: ['thread.toolTabs', 'thread.toolTabsChanged', 'thread.background', 'thread.backgroundChanged']
  },
  'thread.place_actions': {
    label: 'Answer a branch drift; undo, restore or discard a place\'s changes; read a file of a place (F4)',
    forbidden: 'Person-only (A14 Undo, A15): they change or restore files and branches for the person; the place read reaches outside the workspace roots (A17).',
    ipc: ['thread.placeRead', 'thread.placeDriftAnswer', 'thread.placeUndo', 'thread.placeRestore', 'thread.placeDiscard']
  },
  'thread.session_admin': {
    label: 'Fork, delete, clean up or search CLI sessions',
    excluded: 'Deletes or copies the person\'s CLI history across projects. Agents read the project with oxespace_project_context and oxespace_search.',
    ipc: ['session.fork', 'session.delete', 'session.cleanup', 'session.search']
  },

  // ---- Delegation, work -----------------------------------------------------------
  'delegation.use': {
    label: 'Delegate a task and follow it',
    tools: {
      oxespace_delegate_task: 'write', oxespace_delegation_targets: 'read', oxespace_delegation_preflight: 'read', oxespace_delegation_status: 'read', oxespace_delegation_inbox: 'read',
      oxespace_delegation_result: 'read', oxespace_delegation_control: 'write', oxespace_delegation_context: 'read', oxespace_delegation_update: 'write',
      oxespace_delegation_checkpoint: 'write', oxespace_delegation_message: 'write', oxespace_delegation_acknowledge: 'write'
    },
    ipc: ['delegation.create', 'delegation.status', 'delegation.preview', 'delegation.control']
  },
  'delegation.authorize': {
    label: 'Authorize delegation targets and adopt delegations',
    forbidden: 'Raises access: decides where agents may start work.',
    ipc: ['delegation.configure', 'delegation.configureTarget', 'delegation.adopt']
  },
  'work.plans': {
    label: 'Work plans: plan, status, result, message, cancel',
    tools: { oxespace_work_plan: 'write', oxespace_work_status: 'read', oxespace_work_result: 'read', oxespace_work_message: 'write', oxespace_work_cancel: 'write' },
    ipc: ['thread.workRuns', 'thread.cancelWork']
  },

  // ---- OxeQuery (databases) and OxePod (containers) -------------------------------------------
  'oxequery.read': {
    label: 'Connections, schemas, read queries, plans, activity',
    tools: {
      oxespace_db_connections: 'read', oxespace_db_describe: 'read', oxespace_db_explain: 'read', oxespace_db_activity: 'read',
      oxespace_db_query: 'confirm', oxespace_mongo_find: 'confirm', oxespace_mongo_aggregate: 'confirm'
    },
    ipc: ['oxeQuery.call']
  },
  'oxequery.write': { label: 'Change data or schema', tools: { oxespace_db_execute: 'confirm', oxespace_mongo_write: 'confirm' }, ipc: ['oxeQuery.call'] },
  'oxequery.saved_queries': {
    label: 'Saved queries, history, import and export of data',
    excluded: 'The person\'s notebook and bulk data moves; agents run one approved statement at a time.',
    ipc: ['oxeQuery.call']
  },
  'oxequery.secrets': {
    label: 'Connection credentials, SSH host keys, export and import of connections',
    forbidden: 'Secrets and trust.',
    ipc: ['oxeQuery.call']
  },
  'containers.runtime': {
    label: 'Containers (OxePod): list, logs, start, stop, restart',
    tools: { oxespace_containers_list: 'read', oxespace_container_logs: 'read', oxespace_container_action: 'confirm' },
    ipc: ['oxePod.call']
  },
  'containers.panel': {
    label: 'The Containers panel: stack, status, uptime, database flag and who started each container',
    forbidden: 'The window\'s read model: rows carry other conversations\' titles, so agents never reach it.',
    ipc: ['oxePod.containers.panel']
  },
  'containers.resources': {
    label: 'Images, volumes, networks, compose, exec and shell, stats, database containers',
    planned: 'P7', reason: 'OxePod shows them to the person (P1-P3); tools for them come with P7. Removing a container and cleaning up stopped containers or dangling images are confirmed actions of the person in OxePod and are not tools. The environment of a container reaches the page redacted (P6) and never an agent.',
    ipc: ['oxePod.call']
  },

  // ---- skills, MCP servers --------------------------------------------------
  'skills.use': {
    label: 'Skills: list, read, add',
    tools: { ...each('oxespace_skills', 'read', ['list', 'get']), ...each('oxespace_skills_change', 'confirm', ['create']) },
    ipc: ['skill.list', 'skill.get', 'skill.create']
  },
  'skills.invoke': { label: 'Invoke a skill in a pane', excluded: 'Types the skill into a terminal. Agents read its body with oxespace_skills get.', ipc: ['skill.invoke'] },
  'mcp.servers': {
    label: 'MCP servers: list, health, start, stop',
    tools: { ...each('oxespace_mcp_servers', 'read', ['list']), ...each('oxespace_mcp_servers_change', 'confirm', ['start']), ...each('oxespace_mcp_servers_change', 'write', ['stop']) },
    ipc: ['mcp.list', 'mcp.start', 'mcp.stop', 'mcp.test', 'mcp.diagnose']
  },
  'mcp.server_trust': {
    label: 'Add, edit, import, trust (also again after a quarantine) or sign in to MCP servers',
    forbidden: 'MCP server trust, including trusting a quarantined server again; commands, environment and headers carry secrets. An agent can only read that a server is quarantined (oxespace_mcp_servers#list).',
    ipc: ['mcp.create', 'mcp.update', 'mcp.delete', 'mcp.discover', 'mcp.importDiscovered', 'mcp.openSignIn']
  },
  'mcp.call_tool': { label: 'Call another server\'s tool from the app', excluded: 'Agents reach those servers through their own MCP client, as the person trusted them.', ipc: ['mcp.callTool'] },

  // ---- usage, settings, accounts ---------------------------------------------------------
  'usage.read': {
    label: 'Context window and plan allowance',
    tools: each('oxespace_usage', 'read', ['context', 'credits']),
    ipc: ['contextUsage.get', 'agentCredits.get']
  },
  'usage.copilot': { label: 'GitHub Copilot allowance', excluded: 'No agent OXESpace starts runs on Copilot; the panel is for Copilot panes.', ipc: ['copilot.credits'] },
  'settings.policy': { label: 'Organization policy in force', tools: each('oxespace_settings', 'read', ['policy']), ipc: ['policy.get', 'policy.onChanged'] },
  'policy.accept_change': {
    label: 'Accept, or review again, a policy file changed outside OXESpace (B7.4)',
    forbidden: 'Person-only, like an approval: accepting an outside change to the rules is what keeps an agent from widening them.',
    ipc: ['policy.acceptChange', 'policy.reviewChange']
  },
  'settings.app': {
    label: 'Appearance, UI scale, app updates, RTK, agent hooks',
    excluded: 'The person\'s app maintenance; installing hooks writes into the agents\' own configuration.',
    ipc: ['app.*', 'agentHooks.*', 'mcpInternal.toolGroups', 'mcpInternal.toolRules']
  },
  'app.open_external': {
    label: 'Open a link in the system browser or mail app',
    forbidden: 'Person-only, like an approval: the window calls it after the person confirmed the link\'s host.',
    ipc: ['app.openExternal']
  },
  'app.open_in': {
    label: 'Open a project file in an installed editor or show it in its folder (B18)',
    forbidden: 'For 1.4, person-only: it starts a program on the computer, so an agent cannot reach it.',
    ipc: ['app.openIn', 'app.openInTargets', 'app.setOpenInPreference']
  },
  'app.activity': {
    label: 'The activity center\'s entries and when the person last looked at them (F30)',
    forbidden: 'For 1.4, the person\'s own notification history: an agent neither reads it nor writes into it.',
    ipc: ['activity.recent', 'activity.record', 'activity.seen', 'activity.resolve']
  },
  'mcp_internal.tool_groups_admin': { label: 'Choose how a project offers each group of OXESpace tools', forbidden: 'Raises what agents can reach.', ipc: ['mcpInternal.setToolGroupMode'] },
  'settings.diagnostics': {
    label: 'Diagnostics snapshot, live measurements, problem bundles and reports',
    excluded: 'Whole-app paths and logs, and measuring only while the panel is open; the person exports or clears them.',
    ipc: ['diagnostics.getSnapshot', 'diagnostics.exportReport', 'diagnostics.reportInteractive', 'diagnostics.buildIssueReport', 'diagnostics.recordFirstAnswer',
      'diagnostics.watch', 'diagnostics.unwatch', 'diagnostics.clearIncidents', 'diagnostics.previewBundle', 'diagnostics.exportBundle', 'diagnostics.analysisSummary']
  },
  'diagnostics.read': {
    label: 'Summary of the incident journal and a snapshot of the app',
    // The same Markdown as the window's "Ask for an analysis": incident codes, areas and counts, with aggregate processes
    // and storage. Never content, paths or raw errors.
    tools: { oxespace_diagnostics: 'read' },
    ipc: ['diagnostics.incidents']
  },
  'remote.devices_read': { label: 'Remote gateway status and paired phones', excluded: 'The person\'s devices, shown in Settings › Devices; agents have no use for them.', ipc: ['remote.status', 'remote.devices'] },
  'remote.gateway_admin': {
    label: 'Turn the remote gateway on or off, pair, answer, revoke or rename a phone, name the desktop, let a phone type into a pane, keep a pane off the phone',
    forbidden: 'Opens a network surface and grants device access.',
    ipc: ['remote.setEnabled', 'remote.startPairing', 'remote.cancelPairing', 'remote.answerPairing', 'remote.revoke', 'remote.rename', 'remote.setDesktopName', 'remote.setPhoneWrite', 'remote.setPhoneHidden', 'remote.firewallStatus', 'remote.firewallRepair', 'remote.firewallUndo']
  },
  'mcp.tool_rules_admin': { label: 'Choose, per MCP tool, to run it without asking, ask, or block it', forbidden: 'Approvals and access stay with the person.', ipc: ['mcpInternal.setToolRule'] },
  'settings.data_export': {
    label: 'The one-time export of the features removed in 1.5, its notice, and opening the file',
    excluded: 'The person\'s own data, saved once for them; opening the file or exporting again is theirs.',
    ipc: ['dataExport.*']
  },
  'settings.agent_audit': {
    label: 'Audit of agent actions; internal MCP status',
    excluded: 'The person\'s review of what agents did. OxeQuery\'s trail is oxespace_db_activity.',
    ipc: ['mcpInternal.getStatus', 'mcpInternal.actionAudit', 'mcpInternal.exportAudit', 'thread.auditLog']
  },
  'http_audit.list': {
    label: 'List HTTP audit calls',
    excluded: "The person's review of HTTP calls made by agents.",
    ipc: ['httpAudit.list']
  },
  'agent_activity.read': {
    label: 'List, detail and badge of agent activity',
    excluded: "The person's review of what agents did across changes, databases, containers and HTTP.",
    ipc: ['agentActivity.list', 'agentActivity.detail', 'agentActivity.badge']
  },
  'code.pane_conversation': {
    label: "A terminal agent's conversation on the desktop (A53)",
    excluded: "The person's read-only view of a pane's native session. Agents read panes with oxespace_agents read and sessions with oxespace_threads native_sessions.",
    ipc: ['paneConversation.*']
  },
  'mcp_internal.token': { label: 'Regenerate the internal MCP token', forbidden: 'A token.', ipc: ['mcpInternal.regenerateToken'] },
  'accounts.sign_in': { label: 'Sign in or out of Claude, Codex and other accounts', forbidden: 'Sign-in and tokens.', ipc: ['agentAccount.*'] },
  'settings.feature_usage': {
    label: 'Local-only feature usage counter: switch, export, clear and feature counts (A65)',
    forbidden: 'Person-only local usage preferences and counts; agents neither read nor change them.',
    ipc: ['featureUsage.state', 'featureUsage.setEnabled', 'featureUsage.export', 'featureUsage.clear', 'featureUsage.record']
  },
  'settings.hosts_proxy': {
    label: 'Loopback outgoing-hosts proxy: switch, clear and retry (A68)',
    forbidden: 'Person-only network inspection control; agents must not turn off or clear their own host log.',
    ipc: ['hostsProxy.state', 'hostsProxy.setEnabled', 'hostsProxy.clear', 'hostsProxy.retry']
  },

  // ---- push events from main to the window ----------------------------------------------
  'app.events': {
    label: 'Change notifications sent to the window',
    excluded: 'Events, not actions: agents read the state they describe with the tools above.',
    ipc: ['*.on*', '*.changed', 'remote.pairingFailed', 'approvals.openRequest']
  },

  // ---- future products ----------------------------------------------------------------------
  'oxepost.all': { label: 'OxePost: collections, environments, sending', planned: 'H8', reason: 'OxePost (H1-H4) is the person\'s API client: collections, environments and sending have no tool yet; H8 adds list, read and create, and send with GET and HEAD to localhost free and the rest confirmed. Environment secrets stay in the system\'s secure storage and are never a tool, an argument or a result.' }
}
