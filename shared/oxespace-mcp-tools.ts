import type { ToolRowKind } from './thread-tool-rows'

export interface OxespaceToolSpec {
  kind: ToolRowKind
  label: string
  argKeys?: readonly string[]
  /** When true and a primary SQL/query arg is present, use the raw arg directly as the row target. */
  rawPrimaryArg?: boolean
}

/**
 * Rich classification and human-readable descriptors for internal OXESpace MCP tools
 * (`oxespace_*`, whether bare, dot-prefixed, or `mcp__oxespace*__oxespace_*`).
 */
export const OXESPACE_MCP_TOOLS: Record<string, OxespaceToolSpec> = {
  // OxeQuery (SQL & Mongo)
  oxespace_db_connections: { kind: 'query', label: 'DB connections' },
  oxespace_db_describe: { kind: 'query', label: 'DB schema', argKeys: ['table', 'schema', 'connection', 'database'] },
  oxespace_db_query: { kind: 'query', label: 'SQL query', argKeys: ['sql', 'query', 'connection'], rawPrimaryArg: true },
  oxespace_db_execute: { kind: 'query', label: 'SQL execute', argKeys: ['sql', 'query', 'connection'], rawPrimaryArg: true },
  oxespace_db_explain: { kind: 'query', label: 'SQL explain', argKeys: ['sql', 'query', 'connection'], rawPrimaryArg: true },
  oxespace_db_activity: { kind: 'query', label: 'DB activity', argKeys: ['connection', 'database'] },
  oxespace_mongo_find: { kind: 'query', label: 'Mongo find', argKeys: ['collection', 'connection'] },
  oxespace_mongo_aggregate: { kind: 'query', label: 'Mongo aggregate', argKeys: ['collection', 'connection'] },
  oxespace_mongo_write: { kind: 'query', label: 'Mongo write', argKeys: ['collection', 'operation', 'connection'] },

  // Containers
  oxespace_containers_list: { kind: 'container', label: 'List containers' },
  oxespace_container_logs: { kind: 'container', label: 'Container logs', argKeys: ['container', 'name', 'id', 'service'] },
  oxespace_container_action: { kind: 'container', label: 'Container', argKeys: ['action', 'container', 'name', 'id'] },
  oxespace_container_stats: { kind: 'container', label: 'Container stats', argKeys: ['container', 'name', 'id'] },

  // Web Preview, HTTP & GitHub
  oxespace_open_web_preview: { kind: 'http', label: 'Open web preview', argKeys: ['url', 'path', 'title'] },
  oxespace_capture_web_preview: { kind: 'http', label: 'Capture web preview', argKeys: ['url', 'selector'] },
  oxespace_preview_interact: { kind: 'http', label: 'Web preview', argKeys: ['action', 'selector', 'url', 'text'] },
  oxespace_github: { kind: 'http', label: 'GitHub', argKeys: ['action', 'repo', 'pr', 'number', 'query', 'runId'] },
  oxespace_github_change: { kind: 'http', label: 'GitHub', argKeys: ['action', 'title', 'repo', 'pr', 'number'] },
  oxespace_http: { kind: 'http', label: 'HTTP request', argKeys: ['method', 'url'] },
  oxespace_http_request: { kind: 'http', label: 'HTTP request', argKeys: ['method', 'url'] },

  // Android / Device
  oxespace_device_screenshot: { kind: 'read', label: 'Android screenshot', argKeys: ['serial', 'device', 'name'] },

  // Git
  oxespace_git: { kind: 'read', label: 'Git', argKeys: ['action', 'ref', 'branch', 'path'] },
  oxespace_git_change: { kind: 'edit', label: 'Git', argKeys: ['action', 'branch', 'message', 'path'] },

  // Search, Context, Diagnostics & Inspection
  oxespace_search: { kind: 'read', label: 'Project search', argKeys: ['query', 'pattern', 'path', 'action'] },
  oxespace_capabilities: { kind: 'read', label: 'Capabilities' },
  oxespace_project_context: { kind: 'read', label: 'Project context' },
  oxespace_execution_context: { kind: 'read', label: 'Execution context' },
  oxespace_diagnostics: { kind: 'read', label: 'Diagnostics', argKeys: ['path', 'scope'] },
  oxespace_usage: { kind: 'read', label: 'Usage' },
  oxespace_settings: { kind: 'read', label: 'Settings', argKeys: ['action', 'key', 'section'] },
  oxespace_skills: { kind: 'read', label: 'Skills', argKeys: ['action', 'name'] },
  oxespace_mcp_servers: { kind: 'read', label: 'MCP servers', argKeys: ['action', 'name'] },
  oxespace_terminal: { kind: 'read', label: 'Terminal output', argKeys: ['action', 'paneId', 'name'] },
  oxespace_tasks: { kind: 'read', label: 'Tasks', argKeys: ['action', 'taskId', 'id'] },
  oxespace_agents: { kind: 'read', label: 'Agents', argKeys: ['action', 'paneId', 'name'] },
  oxespace_integration: { kind: 'read', label: 'Integrations', argKeys: ['action', 'group', 'name'] },
  oxespace_list_workspaces: { kind: 'read', label: 'List workspaces' },
  oxespace_list_panes: { kind: 'read', label: 'List panes' },
  oxespace_list_worktrees: { kind: 'read', label: 'List worktrees' },
  oxespace_list_scripts: { kind: 'read', label: 'List scripts' },
  oxespace_list_background_jobs: { kind: 'read', label: 'List background jobs' },
  oxespace_list_agents: { kind: 'read', label: 'List agents' },
  oxespace_get_job_output: { kind: 'read', label: 'Job output', argKeys: ['jobId', 'id', 'name'] },

  // Threads
  oxespace_threads: { kind: 'read', label: 'Threads', argKeys: ['action', 'threadId', 'query'] },
  oxespace_thread_read: { kind: 'read', label: 'Read thread', argKeys: ['threadId', 'id'] },
  oxespace_thread_create: { kind: 'run', label: 'Create thread', argKeys: ['title', 'prompt', 'provider'] },
  oxespace_thread_send: { kind: 'run', label: 'Send to thread', argKeys: ['threadId', 'message', 'prompt'] },
  oxespace_threads_change: { kind: 'edit', label: 'Threads', argKeys: ['action', 'threadId', 'title'] },

  // Quality, Scripts & Orchestration
  oxespace_quality_check: { kind: 'run', label: 'Quality check', argKeys: ['scope', 'target', 'check', 'action'] },
  oxespace_run_script: { kind: 'run', label: 'Run script', argKeys: ['script', 'name', 'command'] },
  oxespace_stop_background_job: { kind: 'run', label: 'Stop background job', argKeys: ['jobId', 'id', 'name'] },
  oxespace_tools_enable: { kind: 'run', label: 'Enable tools', argKeys: ['group', 'groups'] },
  oxespace_agents_change: { kind: 'run', label: 'Agents', argKeys: ['action', 'agent', 'paneId', 'prompt'] },
  oxespace_mcp_servers_change: { kind: 'run', label: 'MCP servers', argKeys: ['action', 'name', 'server'] },
  oxespace_delegation_context: { kind: 'read', label: 'Delegation context', argKeys: ['delegationId', 'taskId'] },
  oxespace_delegation_targets: { kind: 'read', label: 'Delegation targets' },
  oxespace_delegation_preflight: { kind: 'read', label: 'Delegation preflight', argKeys: ['target', 'branch'] },
  oxespace_delegation_status: { kind: 'read', label: 'Delegation status', argKeys: ['delegationId', 'taskId'] },
  oxespace_delegation_inbox: { kind: 'read', label: 'Delegation inbox', argKeys: ['delegationId', 'taskId'] },
  oxespace_delegation_result: { kind: 'read', label: 'Delegation result', argKeys: ['delegationId', 'taskId'] },
  oxespace_delegate_task: { kind: 'run', label: 'Delegate task', argKeys: ['title', 'task', 'target', 'branch'] },
  oxespace_delegation_control: { kind: 'run', label: 'Delegation control', argKeys: ['action', 'delegationId', 'taskId'] },
  oxespace_delegation_update: { kind: 'run', label: 'Delegation update', argKeys: ['status', 'summary', 'delegationId'] },
  oxespace_delegation_checkpoint: { kind: 'run', label: 'Delegation checkpoint', argKeys: ['summary', 'delegationId'] },
  oxespace_delegation_message: { kind: 'run', label: 'Delegation message', argKeys: ['message', 'delegationId'] },
  oxespace_delegation_acknowledge: { kind: 'run', label: 'Delegation acknowledge', argKeys: ['delegationId', 'messageId'] },
  oxespace_work_plan: { kind: 'run', label: 'Work plan', argKeys: ['title', 'goal', 'action'] },
  oxespace_work_status: { kind: 'read', label: 'Work status', argKeys: ['runId', 'taskId'] },
  oxespace_work_result: { kind: 'read', label: 'Work result', argKeys: ['runId', 'taskId'] },
  oxespace_work_message: { kind: 'run', label: 'Work message', argKeys: ['message', 'taskId', 'runId'] },
  oxespace_work_cancel: { kind: 'run', label: 'Cancel work', argKeys: ['runId', 'taskId'] },

  // Workspace, Worktree, Skills & Tasks mutations
  oxespace_create_worktree: { kind: 'edit', label: 'Create worktree', argKeys: ['branch', 'path', 'name'] },
  oxespace_remove_worktree: { kind: 'edit', label: 'Remove worktree', argKeys: ['branch', 'path', 'name'] },
  oxespace_skills_change: { kind: 'edit', label: 'Skills', argKeys: ['action', 'name'] },
  oxespace_tasks_change: { kind: 'edit', label: 'Tasks', argKeys: ['action', 'title', 'taskId'] },
  oxespace_workspace_change: { kind: 'edit', label: 'Workspace', argKeys: ['action', 'title', 'message'] }
}

const FALLBACK_ARG_KEYS = ['description', 'action', 'url', 'sql', 'query', 'path', 'command', 'name', 'title'] as const

function stripPrefix(rawName: string): string {
  const mcp = /^mcp__[^_].*?__(.+)$/.exec(rawName)
  if (mcp) return mcp[1]
  const dot = /^[^.]+\.(.+)$/.exec(rawName)
  if (dot) return dot[1]
  return rawName
}

function humanizeSlug(name: string): string {
  const words = name.replace(/^oxespace_/, '').replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
}

function inferFallbackKind(name: string): ToolRowKind {
  if (/^oxespace_(?:db|mongo)_/.test(name)) return 'query'
  if (/^oxespace_container/.test(name)) return 'container'
  if (/^oxespace_http(?:_|$)/.test(name)) return 'http'
  if (/^oxespace_android_/.test(name)) return 'run'
  if (/^oxespace_(?:list|get|read)_/.test(name)) return 'read'
  if (/^oxespace_.*_change$/.test(name)) return 'edit'
  return 'other'
}

export function isOxespaceMcpTool(rawName: string): boolean {
  return stripPrefix(rawName).startsWith('oxespace_')
}

export function lookupOxespaceTool(rawName: string): OxespaceToolSpec | undefined {
  const name = stripPrefix(rawName)
  if (!name.startsWith('oxespace_')) return undefined
  return OXESPACE_MCP_TOOLS[name] ?? { kind: inferFallbackKind(name), label: humanizeSlug(name) }
}

export function classifyOxespaceToolKind(rawName: string): ToolRowKind | undefined {
  return lookupOxespaceTool(rawName)?.kind
}

export function oxespaceToolLabel(rawName: string): string | undefined {
  return lookupOxespaceTool(rawName)?.label
}

function readArg(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value === 'string' && value.trim()) return value.trim().split(/\r?\n/, 1)[0]
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) {
    const joined = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(', ')
    if (joined) return joined
  }
  return ''
}

function extractOxespaceArg(rawDetail: string, spec: OxespaceToolSpec): string {
  const detail = rawDetail.trim()
  if (!detail) return ''
  if (!detail.startsWith('{')) return detail.split(/\r?\n/, 1)[0].trim()
  try {
    const input = JSON.parse(detail) as Record<string, unknown>
    const keys = spec.argKeys ?? FALLBACK_ARG_KEYS
    const primary = keys.map(key => [key, readArg(input, key)] as const).find(([, val]) => val.length > 0)
    if (primary) {
      const [firstKey, firstVal] = primary
      // Pair verb-like first args (action / method) with a secondary subject when available (e.g. "diff src/app.ts", "POST /api").
      if (firstKey === 'action' || firstKey === 'method') {
        const secondary = keys.slice(keys.indexOf(firstKey) + 1).map(key => readArg(input, key)).find(val => val.length > 0)
        if (secondary && secondary !== firstVal) return `${firstVal} ${secondary}`
      }
      return firstVal
    }
    for (const key of FALLBACK_ARG_KEYS) {
      const val = readArg(input, key)
      if (val) return val
    }
    return ''
  } catch {
    return ''
  }
}

export function oxespaceToolTarget(rawName: string, rawDetail: string): string | null {
  const spec = lookupOxespaceTool(rawName)
  if (!spec) return null
  const arg = extractOxespaceArg(rawDetail, spec)
  if (!arg) return spec.label
  if (spec.rawPrimaryArg) return arg
  return `${spec.label} · ${arg}`
}

export function oxespaceToolSummary(rawName: string, rawDetail: string): string | null {
  const target = oxespaceToolTarget(rawName, rawDetail)
  return target ? target.replace(/\s+/g, ' ').slice(0, 180) : null
}
