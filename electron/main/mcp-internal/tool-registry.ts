import type { BackgroundManager } from '../services/background.service'
import type { FileSystemService } from '../services/file-system.service'
import type { GitHubWorktreeApi } from '../../../shared/types/github'
import type { WorkspaceService } from '../services/workspace.service'
import type {
  InternalMcpContentBlock,
  InternalMcpToolCallResult,
  InternalMcpToolDescriptor
} from '../../../shared/types/mcp-internal'
import { INTERNAL_MCP_ERROR_CODES } from '../../../shared/types/mcp-internal'
import { handlers } from './tool-handlers'
import type { WebPreviewBus } from './web-preview-bus'
import type { WorktreeEventBus } from './worktree-event-bus'

/**
 * Static catalogue of tools the internal MCP server exposes. Each entry pairs
 * the public JSON-Schema (sent verbatim on `tools/list`) with a server-side
 * handler that translates `arguments` into a call against existing services
 * and returns an MCP `content[]` payload.
 *
 * Why hand-written JSON Schemas instead of zod/io-ts? The McpManager (lines
 * 310-358 of mcp.service.ts) and the bridge use plain JSON — adding a runtime
 * validator here would force a new dep without observable benefit. Validation
 * happens inline in each handler.
 */
import { DELEGATION_TOOLS } from './delegation-tools'
import { createHash, randomUUID } from 'node:crypto'
import { projectIdentity } from '../services/project-identity'
import { execGit } from '../utils/safe-git'
import { CONFIGURABLE_MCP_TOOL_GROUPS as TOOL_GROUP_NAMES } from '../../../shared/types/mcp-tools'
import { THREAD_HANDOFF_TOOLS } from './thread-handoff-tools'
import { OXEQUERY_TOOLS } from './oxequery-tools'
import { GIT_TOOLS } from './git-tools'
import { APP_READ_TOOLS } from './app-read-tools'
import { APP_WRITE_TOOLS } from './app-write-tools'
import { APP_MANAGE_TOOLS } from './app-manage-tools'
import { APP_SETTINGS_TOOLS } from './app-settings-tools'
import { gated } from './domain-tool'
import { AGENT_CHANGE_TOOLS, AGENT_READ_TOOLS } from './agent-tools'

export interface ToolContext {
  captureRoot?: string
  db?: import('../db').AppDatabase
  threads?: Promise<import('../services/conversation/thread-manager').ThreadManager>
  /** The browser preview automation (services/browser-preview, R0c). The field keeps its name: local-rpc-server passes it through. */
  documentation?: () => Promise<{ preview: import('../services/browser-preview/preview-automation').PreviewAutomation }>
  delegation?: import('../services/delegation.service').DelegationService
  /** R7: the Teams UI and team MCP tools are gone. bootstrap.ts (outside R7's files) still forwards this; nothing here reads it. */
  team?: unknown
  executions?: import('../services/execution-registry').ExecutionRegistry
  executionId?: string
  executionToken?: string
  delegationAgents?: () => unknown
  /** R5: AI Memory is gone. local-rpc-server.ts (outside R5's files) still forwards these two; nothing here reads them. */
  memory?: { observe(params: unknown): Promise<unknown> }
  memoryRunId?: string
  /** OxeQuery's agent gateway, available once the service has started. */
  oxeQuery?: () => import('../services/oxequery/agent-gateway').AgentGateway | undefined
  /** Why OxeQuery is not running, when it failed to start. */
  oxeQueryError?: () => string | undefined
  /** Policy for app tools outside OxeQuery: levels, approvals, rate limit, audit. */
  agentActions?: import('../services/agent-actions/agent-actions').AgentActions
  /** Services the domain tools reach (GitHub, tasks, skills, Linear, terminal output...). */
  app?: import('./app-services').AppServices
  git?: Pick<import('../services/git.service').GitService, 'getStatus' | 'getBranch' | 'getDiffSummary' | 'buildDiff' | 'getFileAtRef'>
  workspaceId: string | null
  workspaceServ: WorkspaceService
  github: GitHubWorktreeApi
  background: BackgroundManager
  fileSystem: FileSystemService
  webPreview: WebPreviewBus
  worktree: WorktreeEventBus
  /** A63: the guarded worktree removal; oxespace_remove_worktree goes through it without branch deletion. */
  worktreesPanel?: import('../services/github/worktree-guard').WorktreeRemoveGuard
  androidAccess?: () => import('../services/android/android-devices').AndroidAgentAccess | undefined
  askAndroidScreenshot?: (input: { serial: string; sessionKey: string; owner: { kind: 'pane' | 'thread'; id: string }; label: string }) => Promise<boolean>
}

export interface ToolEntry {
  descriptor: InternalMcpToolDescriptor
  requiresWorkspace: boolean
  handler: (args: unknown, ctx: ToolContext) => Promise<InternalMcpToolCallResult>
  /** Characters of text the result may carry before it is cut; DEFAULT_TOOL_OUTPUT_LIMIT when absent. */
  outputLimit?: number
}

/** What each optional group is for, as oxespace_capabilities tells an agent. */
const TOOL_GROUP_PURPOSES = {
  orchestration: 'start other agents and conversations, delegate and follow Work runs',
  data: 'databases and containers through OxeQuery; every data read and change is approved by a person',
  docs: 'web previews and documentation captures',
  app: 'Git, GitHub, conversations, skills, MCP servers, search, usage and settings'
}

/**
 * Turns a tool group on for this session. The OXESpace bridge of a conversation answers it, since it owns the
 * session's tool list; reaching the server means this session has nothing left to turn on.
 */
const toolsEnable: ToolEntry = {
  descriptor: {
    name: 'oxespace_tools_enable',
    description: 'Turn on a group of OXESpace tools for this session: orchestration, data, docs, app, or code (a Code terminal\'s worktrees, tasks, agents and integrations). Read-only: it changes which tools you see, not what they may do; groups the project turned off stay off.',
    inputSchema: { type: 'object', properties: { group: { type: 'string', enum: [...TOOL_GROUP_NAMES, 'code'] } }, required: ['group'], additionalProperties: false },
    // True: it changes nothing outside the session; each tool it lists keeps its own level and approval.
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  requiresWorkspace: false,
  // The bridge answers this when it owns the session's groups. Reaching the server means a direct caller or a bridge
  // with nothing to turn on: refuse what is not a group, the same codes as the bridge, never an "ok" for nonsense.
  handler: async args => {
    const reply = (body: Record<string, unknown>, isError = false) => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ schemaVersion: 1, ...body }) }], ...(isError ? { isError: true } : {})
    })
    const group = args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 1 ? (args as { group?: unknown }).group : undefined
    if (typeof group !== 'string') return reply({ status: 'error', error: { code: 'INVALID_ARGUMENTS', message: 'Pass { "group": "<name>" }.', retryable: false } }, true)
    if (![...TOOL_GROUP_NAMES, 'code'].includes(group)) {
      return reply({ status: 'error', error: { code: 'GROUP_UNAVAILABLE', message: `Unknown group "${group.slice(0, 40)}". Groups: ${[...TOOL_GROUP_NAMES, 'code'].join(', ')}.`, retryable: false } }, true)
    }
    return reply({ status: 'ok', data: { enabled: [], note: 'Nothing to turn on here: this caller already lists every OXESpace tool it can use.' } })
  }
}

/** Discovery is read-only and authenticated. R8 moved it here when automation-tools.ts left. */
export function discoveryTools(catalogue: () => ToolEntry[]): ToolEntry[] {
  // Discovery first, in the order agents and tests know; the group switch B7.2 adds comes last.
  return [...['oxespace_capabilities', 'oxespace_execution_context'].map((name): ToolEntry => ({
    descriptor: { name, description: name === 'oxespace_capabilities'
      ? 'Discover registered OXESpace tools and execution requirements. Availability is not authorization.'
      : 'Read your authenticated launch workspace, pane and Git checkout. Does not infer your shell current directory.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    requiresWorkspace: true,
    handler: async (args, ctx) => {
      const requestId = randomUUID()
      const reply = (status: string, data: unknown, isError = false) => ({ content: [{ type: 'text' as const,
        text: JSON.stringify({ schemaVersion: 1, requestId, status, ...(isError ? { error: data } : { data }) }) }], ...(isError ? { isError: true } : {}) })
      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length)) {
        return reply('error', { code: 'INVALID_ARGUMENTS', message: 'This tool takes an empty object.', retryable: false }, true)
      }
      let execution
      try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) }
      catch { /* Never return credential-bearing errors. */ }
      if (!execution) return reply('error', { code: 'EXECUTION_REQUIRED', message: 'Open a new OXESpace agent terminal.', retryable: false }, true)
      const workspace = ctx.workspaceServ.get(execution.workspaceId)
      const pane = workspace?.panes.find(p => p.id === execution.paneId)
      if (execution.owner.kind === 'pane' && !pane) return reply('error', { code: 'PANE_UNAVAILABLE', message: 'The execution pane no longer exists.', retryable: false }, true)
      if (name === 'oxespace_capabilities') return reply('ok', {
        tools: catalogue().map(t => ({ name: t.descriptor.name, requiresWorkspace: t.requiresWorkspace })),
        workspaceId: execution.workspaceId,
        delegationServiceAvailable: Boolean(ctx.delegation),
        // Discovery must not wait for filesystem identity or Git on a busy host.
        // Delegation preflight performs the detailed check when requested.
        delegation: { status: ctx.delegation ? 'available' : 'unavailable', details: 'Use oxespace_delegation_preflight for project eligibility.' },
        policy: 'Every action revalidates scope, ownership and project opt-in. Listed tools may require additional setup.',
        limits: { concurrentDelegationsPerProject: 4, recursiveDelegation: false },
        // A conversation is offered only some groups; say how to get the others.
        ...(execution.owner.kind === 'thread' ? { threadToolGroups: {
          offered: 'core tools, plus team or delegation/work tools when this conversation has that role, plus each group the project does not turn off',
          groups: TOOL_GROUP_PURPOSES,
          enable: 'With tool search, search for the tool you need. Otherwise call oxespace_tools_enable with the group; sessionToolGroups lists what can still be turned on. A group the project turns off stays off.'
        } } : {})
      })
      let git: unknown = { status: 'unavailable' }
      let repositoryIdentity: string | null = null
      try {
        repositoryIdentity = `local-project-sha256:${createHash('sha256').update(await projectIdentity(execution.cwd)).digest('hex')}`
        const result = await execGit(execution.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 2000, maxBuffer: 8192 })
        const head = await execGit(execution.cwd, ['rev-parse', '--verify', 'HEAD'], { timeout: 2000, maxBuffer: 8192 })
        git = { status: 'ok', branch: result.stdout.trim(), head: head.stdout.trim(), sampledAt: Date.now() }
      } catch { /* A non-Git or unavailable checkout still has execution context. */ }
      return reply('ok', { surface: execution.owner.kind === 'thread' ? 'thread' : 'code', workspaceId: execution.owner.kind === 'pane' ? execution.workspaceId : null,
        threadId: execution.owner.kind === 'thread' ? execution.owner.id : null, paneId: pane?.id ?? null, executionId: execution.id,
        repositoryIdentity,
        launchCwd: execution.cwd, currentShellCwd: 'unknown', agentProfileId: pane?.agentProfileId ?? null,
        originPaneId: pane?.originPaneId ?? null, git })
    }
  })), toolsEnable]
}

/**
 * R5: the project at a glance for this exact checkout, with AI Memory gone: its folder, branch and HEAD, the instruction
 * files agents read at the root and the top-level entries. Read from Git only, so it needs no filesystem access here.
 */
const projectContext: ToolEntry = {
  descriptor: {
    name: 'oxespace_project_context',
    description: 'Read this checkout at a glance: its folder, Git branch and HEAD, the instruction files at its root (CLAUDE.md, AGENTS.md) and its top-level entries. Use oxespace_search for text and oxespace_git for history.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 1000 } }, additionalProperties: false }
  },
  requiresWorkspace: true,
  handler: async (args, ctx) => {
    const reply = (status: string, data: unknown, isError = false) => ({ content: [{ type: 'text' as const,
      text: JSON.stringify({ schemaVersion: 1, status, ...(isError ? { error: data } : { data }) }) }], ...(isError ? { isError: true } : {}) })
    if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => key !== 'query'))) {
      return reply('error', { code: 'INVALID_ARGUMENTS', message: 'Pass {} or { "query": "<text>" }.', retryable: false }, true)
    }
    let execution
    try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) }
    catch { /* Never return credential-bearing errors. */ }
    if (!execution) return reply('error', { code: 'EXECUTION_REQUIRED', message: 'Open a new OXESpace agent terminal.', retryable: false }, true)
    const cwd = execution.cwd
    const git = async (gitArgs: string[]): Promise<string | null> => {
      try { return (await execGit(cwd, gitArgs, { timeout: 2000, maxBuffer: 65536 })).stdout.trim() } catch { return null }
    }
    const [branch, head, instructions, entries] = await Promise.all([
      git(['rev-parse', '--abbrev-ref', 'HEAD']), git(['rev-parse', '--verify', 'HEAD']),
      git(['ls-files', '--', 'CLAUDE.md', 'AGENTS.md']), git(['ls-tree', '--name-only', 'HEAD'])
    ])
    const lines = (text: string | null): string[] => text ? text.split(/\r?\n/).filter(Boolean) : []
    return reply('ok', {
      checkout: cwd,
      git: branch === null ? { status: 'unavailable' } : { status: 'ok', branch, head },
      instructionFiles: lines(instructions),
      topLevel: lines(entries).slice(0, 200),
      next: 'Read the instruction files first; search with oxespace_search and read history with oxespace_git.'
    })
  }
}

export const TOOL_REGISTRY: ToolEntry[] = [
  ...discoveryTools(() => TOOL_REGISTRY),
  projectContext,
  ...DELEGATION_TOOLS,
  ...THREAD_HANDOFF_TOOLS,
  ...OXEQUERY_TOOLS,
  ...GIT_TOOLS,
  ...APP_READ_TOOLS,
  ...APP_WRITE_TOOLS,
  ...APP_MANAGE_TOOLS,
  ...APP_SETTINGS_TOOLS,
  ...AGENT_READ_TOOLS,
  ...AGENT_CHANGE_TOOLS,
  {
    descriptor: {
      name: 'oxespace_list_workspaces',
      description: 'List all OXESpace workspaces with their id, name, root path and active flag.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    requiresWorkspace: false,
    handler: handlers.listWorkspaces
  },
  {
    descriptor: {
      name: 'oxespace_list_panes',
      description: 'List the panes (terminals) of the current workspace with status, agent and root path.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    requiresWorkspace: true,
    handler: handlers.listPanes
  },
  {
    descriptor: {
      name: 'oxespace_list_worktrees',
      description: 'List the git worktrees for the current workspace (path, branch, isMain, locked, prunable).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    requiresWorkspace: true,
    handler: handlers.listWorktrees
  },
  {
    descriptor: {
      name: 'oxespace_create_worktree',
      description: 'Create a new git worktree at the given path on the given branch.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target folder for the worktree. Must not already exist.' },
          branch: { type: 'string', description: 'Branch name to check out (existing or new).' },
          createBranch: { type: 'boolean', description: 'If true, create the branch (-b). Default false.' },
          baseRef: { type: 'string', description: 'Start point for the new branch, e.g. origin/main or a tag. Only used with createBranch. Defaults to the repository default branch on its remote — never the main worktree HEAD.' },
          fetchBase: { type: 'boolean', description: 'Fetch the remote owning baseRef first, so the branch starts at the real remote tip. Default false.' }
        },
        required: ['path', 'branch'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: gated('oxespace_create_worktree', 'write', handlers.createWorktree)
  },
  {
    descriptor: {
      name: 'oxespace_remove_worktree',
      description: 'Remove the git worktree at the given path. Refused when it has uncommitted changes, is busy, locked, or is the main checkout; never forced, and its branch is kept. A person approves each call.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the worktree to remove.' },
          force: { type: 'boolean', description: 'Ignored: uncommitted changes always refuse the removal.' }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: gated('oxespace_remove_worktree', 'confirm', handlers.removeWorktree, async (args, scope) => (await import('./app-settings-actions')).removeWorktreeApproval(args, scope))
  },
  {
    descriptor: {
      name: 'oxespace_list_scripts',
      description: 'List root package.json scripts plus `.ps1` and `.sh` scripts discovered in the current workspace tree.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    requiresWorkspace: true,
    handler: handlers.listScripts
  },
  {
    descriptor: {
      name: 'oxespace_run_script',
      description: 'Run a script (returned by oxespace_list_scripts) as a background job. Returns the job id.',
      inputSchema: {
        type: 'object',
        properties: {
          scriptId: { type: 'string', description: 'Script id from oxespace_list_scripts (its relative path).' },
          paneRootPath: { type: 'string', description: 'Optional cwd inside the workspace.' }
        },
        required: ['scriptId'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: gated('oxespace_run_script', 'write', handlers.runScript)
  },
  {
    descriptor: {
      name: 'oxespace_list_background_jobs',
      description: 'List background jobs for the current workspace, optionally filtered by status.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['running', 'pending', 'exited', 'failed', 'killed'] }
        },
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.listBackgroundJobs
  },
  {
    descriptor: {
      name: 'oxespace_stop_background_job',
      description: 'Stop a running background job by id. Returns { stopped: true } on success.',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: gated('oxespace_stop_background_job', 'write', handlers.stopBackgroundJob)
  },
  {
    descriptor: {
      name: 'oxespace_get_job_output',
      description: 'Read the buffered stdout/stderr (last ~1000 lines) of a background job by id. Use after oxespace_run_script to check if a build/test passed.',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string', description: 'Job id returned by oxespace_run_script.' } },
        required: ['jobId'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.getJobOutput
  },
  {
    descriptor: {
      name: 'oxespace_open_web_preview',
      description: 'Queue a URL for the current Code or Thread Web Preview. Returns queued, not loaded; confirm with oxespace_preview_interact status/inspect. http(s) on localhost, *.localhost, 127.0.0.1 or [::1] opens directly; any other host waits for a person to approve that exact URL (call again with the same URL once approved). Other schemes, file: included, are refused. External sites also require External preview.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to preview (e.g., http://localhost:5173). Write the host plainly: another spelling of a local address asks first.' }
        },
        required: ['url'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.openWebPreview
  },
  {
    descriptor: {
      name: 'oxespace_capture_web_preview',
      description: 'Capture the active opted-in Web Preview tab with private inputs redacted. Returns a PNG image; optional fileName also saves it under the OXESpace capture directory and returns the absolute path.',
      inputSchema: { type: 'object', properties: { fileName: { type: 'string', description: 'Optional PNG name such as aba-1.png; letters, digits, underscore and hyphen only.' } }, additionalProperties: false }
    },
    requiresWorkspace: true,
    handler: handlers.captureWebPreview
  },
  {
    descriptor: {
      name: 'oxespace_preview_interact',
      description: 'Inspect, diagnose and manage the opted-in browser session. Page mutations need consent and expectedUrl.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { enum: ['inspect', 'status', 'console', 'network', 'tabs', 'newTab', 'selectTab', 'closeTab', 'click', 'fill', 'navigate', 'wait', 'scroll'] },
          expectedUrl: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          url: { type: 'string' },
          tabId: { type: 'string' },
          deltaY: { type: 'number', minimum: -2000, maximum: 2000 }
        },
        required: ['action'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.previewInteract
  },
  {
    descriptor: {
      name: 'oxespace_device_screenshot',
      description: 'Capture a PNG screenshot from a connected Android device when Agents can see is enabled by the person and approved once per session.',
      inputSchema: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Connected Android device serial.' }
        },
        required: ['serial'],
        additionalProperties: false
      }
    },
    requiresWorkspace: false,
    handler: handlers.deviceScreenshot
  },
  {
    descriptor: {
      name: 'oxespace_quality_check',
      description: 'Post-diff quality controller. Maps changed files to unchanged exact-reference consumers, checks test/migration/contract coverage and links acceptance criteria to diff evidence. Run after implementation and before claiming completion; address HIGH findings and pair this heuristic check with the real verification commands.',
      inputSchema: {
        type: 'object',
        properties: {
          baseRef: { type: 'string', description: 'Optional Git base revision to include (for example main or HEAD~1). The worktree and index are always included.' },
          files: { type: 'array', items: { type: 'string' }, description: 'Optional workspace-relative files or directories to scope this check. Use the implementation and test files changed by the current operation.' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria to trace to changed files.' },
          maxFindings: { type: 'number', description: 'Maximum findings returned (1-100, default 30).' }
        },
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.qualityCheck
  }
]

/** The tools this build exposes. */
export function activeTools(): ToolEntry[] {
  return TOOL_REGISTRY
}

export function findTool(name: string): ToolEntry | null {
  return activeTools().find((entry) => entry.descriptor.name === name) ?? null
}

/** Helper used by handlers to build a single text content block. */
export function textResult(value: unknown): InternalMcpToolCallResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const block: InternalMcpContentBlock = { type: 'text', text }
  return { content: [block] }
}

export function errorResult(message: string): InternalMcpToolCallResult {
  const block: InternalMcpContentBlock = { type: 'text', text: message }
  return { content: [block], isError: true }
}

export { INTERNAL_MCP_ERROR_CODES }
