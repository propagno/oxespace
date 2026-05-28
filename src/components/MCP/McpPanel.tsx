import { Activity, ChevronDown, ChevronRight, Circle, CircleDot, Play, Plus, RotateCw, ShieldCheck, Square, Trash2, Wrench, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { CreateMcpServerInput, McpHealthStatus, McpServer, McpStdioConfig } from '../../../shared/types/mcp'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'
import { parseMcpJson } from './parseMcpJson'

interface McpPanelProps {
  workspaceId: string | null
  onClose: () => void
}

export function McpPanel({ workspaceId, onClose }: McpPanelProps): ReactElement {
  const serversSelector = useCallback(selectMcpServers(workspaceId), [workspaceId])
  const servers = useMcpStore(serversSelector).filter((server): server is McpServer => Boolean(server))
  const loading = useMcpStore((s) => s.loading)
  const error = useMcpStore((s) => s.error)
  const load = useMcpStore((s) => s.load)
  const startServer = useMcpStore((s) => s.start)
  const stopServer = useMcpStore((s) => s.stop)
  const removeServer = useMcpStore((s) => s.remove)
  const updateServer = useMcpStore((s) => s.update)
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [trustPromptId, setTrustPromptId] = useState<string | null>(null)
  const [removePromptId, setRemovePromptId] = useState<string | null>(null)
  // Built-in OXESpace MCP — the global row OXESpace auto-creates on boot.
  // Rendered as a special read-only card at the top of the list so users
  // see its status + can regenerate its token but can't delete it.
  const [builtInStatus, setBuiltInStatus] = useState<import('../../../shared/types/mcp-internal').InternalMcpStatus | null>(null)
  const [builtInBusy, setBuiltInBusy] = useState(false)
  const [builtInNotice, setBuiltInNotice] = useState<string | null>(null)

  useEffect(() => { void load(workspaceId) }, [workspaceId, load])

  useEffect(() => {
    // Poll every 5s — the built-in server is steady-state, no need to flood
    // the IPC channel. Was 2s; cumulative cost added measurable jank when
    // combined with other workspace-switch refreshes. The status pill is
    // still responsive to start/stop within ~5s, which is plenty for the
    // dashboard read.
    const tick = (): void => {
      const api = window.oxe?.mcpInternal
      if (!api) return
      void api.getStatus().then(setBuiltInStatus).catch(() => undefined)
    }
    tick()
    const interval = setInterval(tick, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleRegenerateToken = async (): Promise<void> => {
    setBuiltInBusy(true)
    setBuiltInNotice(null)
    try {
      const next = await window.oxe.mcpInternal.regenerateToken()
      setBuiltInStatus(next)
      setBuiltInNotice('Token regenerated. Restart open agent panes to pick up the new env.')
    } catch (err) {
      setBuiltInNotice(err instanceof Error ? err.message : 'Failed to regenerate token')
    } finally {
      setBuiltInBusy(false)
    }
  }

  // The built-in row is global (workspaceId NULL) + name === 'oxespace'.
  // Pull it out of the regular list so the special card renders once and
  // the rest of the panel doesn't try to edit/delete it.
  const builtInServer = servers.find((s) => s.workspaceId === null && s.name === 'oxespace') ?? null
  const otherServers = builtInServer ? servers.filter((s) => s.id !== builtInServer.id) : servers

  const handleStart = async (server: McpServer): Promise<void> => {
    if (!server.trusted) {
      setTrustPromptId(server.id)
      setExpandedId(server.id)
      return
    }
    setBusy(server.id)
    try { await startServer(server.id) } catch { /* error captured in store */ } finally { setBusy(null) }
  }

  const handleTrustAndStart = async (server: McpServer): Promise<void> => {
    setBusy(server.id)
    try {
      await updateServer({ id: server.id, trusted: true })
      await startServer(server.id)
      setTrustPromptId(null)
    } catch {
      /* error captured in store */
    } finally {
      setBusy(null)
    }
  }

  const handleStop = async (id: string): Promise<void> => {
    setBusy(id)
    try { await stopServer(id) } finally { setBusy(null) }
  }

  const handleRemove = async (server: McpServer): Promise<void> => {
    if (removePromptId !== server.id) {
      setRemovePromptId(server.id)
      setExpandedId(server.id)
      return
    }
    setBusy(server.id)
    try {
      await removeServer(server.id)
      setRemovePromptId(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mcp-panel-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="mcp-panel"
        role="dialog"
        aria-modal="true"
        aria-label="MCP servers"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="mcp-panel-header">
          <div className="mcp-panel-title">
            <Activity size={14} aria-hidden="true" />
            <strong>Model Context Protocol</strong>
            <span className="mcp-panel-scope">{workspaceId ? 'workspace' : 'global'}</span>
          </div>
          <div className="mcp-panel-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh"
              disabled={loading}
              onClick={() => void load(workspaceId)}
            >
              <RotateCw size={13} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        {error ? <div className="mcp-panel-error">{error}</div> : null}

        <p className="mcp-panel-sync-note">
          Servers enabled here are written to <code>.mcp.json</code> at the
          workspace root. Claude Code and Copilot CLI (v1.0+) discover the
          file automatically — restart the agent session to pick up added or
          removed tools.
        </p>

        {creating ? (
          <McpCreateForm
            workspaceId={workspaceId}
            onCancel={() => setCreating(false)}
            onCreated={() => setCreating(false)}
          />
        ) : (
          <button type="button" className="mcp-panel-add" onClick={() => setCreating(true)}>
            <Plus size={12} aria-hidden="true" />
            Add MCP server (stdio)
          </button>
        )}

        <div className="mcp-panel-list">
          <McpBuiltinCard
            status={builtInStatus}
            busy={builtInBusy}
            notice={builtInNotice}
            // Prefer the live status (always reflects TOOL_REGISTRY.length).
            // The DB row only has `tools` populated AFTER `manager.start(id)`
            // ran the handshake — and we don't auto-start the internal one
            // because the bridge is spawned by agent CLIs, not by McpManager.
            toolCount={builtInStatus?.toolCount ?? builtInServer?.tools.length ?? 0}
            onRegenerate={() => void handleRegenerateToken()}
            onDismissNotice={() => setBuiltInNotice(null)}
          />
          {otherServers.length === 0 && !creating ? (
            <div className="mcp-panel-empty">
              <Wrench size={32} aria-hidden="true" />
              <strong>No MCP server configured</strong>
              <span>Add a server to expose filesystem, GitHub, database tools to your agents.</span>
            </div>
          ) : (
            otherServers.map((server) => (
              <McpServerRow
                key={server.id}
                server={server}
                busy={busy === server.id}
                expanded={expandedId === server.id}
                onToggle={() => setExpandedId(expandedId === server.id ? null : server.id)}
                trustPrompt={trustPromptId === server.id}
                removePrompt={removePromptId === server.id}
                onTrustAndStart={() => void handleTrustAndStart(server)}
                onCancelTrust={() => setTrustPromptId(null)}
                onStart={() => void handleStart(server)}
                onStop={() => void handleStop(server.id)}
                onRemove={() => void handleRemove(server)}
                onCancelRemove={() => setRemovePromptId(null)}
              />
            ))
          )}
        </div>

        <footer className="mcp-panel-footer">
          Tools from running servers become available to agents via the MCP spec (Anthropic).
          Only <code>stdio</code> transport in this version.
        </footer>
      </section>
    </div>
  )
}

interface McpBuiltinCardProps {
  status: import('../../../shared/types/mcp-internal').InternalMcpStatus | null
  busy: boolean
  notice: string | null
  toolCount: number
  onRegenerate: () => void
  onDismissNotice: () => void
}

function McpBuiltinCard({ status, busy, notice, toolCount, onRegenerate, onDismissNotice }: McpBuiltinCardProps): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const running = status?.running === true
  const port = status?.port ?? null
  const lastError = status?.lastError ?? null
  const tools = status?.tools ?? []
  const pillClass = lastError ? 'health-error' : running ? 'health-healthy' : 'health-idle'
  const pillText = lastError
    ? 'error'
    : running
      ? port !== null
        ? `running · :${port}`
        : 'running'
      : 'stopped'
  return (
    <div className={`mcp-server-row mcp-builtin-row ${pillClass}${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="mcp-server-main"
        aria-label="OXESpace built-in MCP server"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <HealthIndicator status={lastError ? 'unhealthy' : running ? 'healthy' : 'unknown'} />
        <div className="mcp-server-body">
          <strong>OXESpace built-in <span className="mcp-server-tag scope-global">auto</span></strong>
          <span className="mcp-server-meta">
            <span className={`mcp-server-tag mcp-builtin-status ${running ? 'on' : 'off'}`}>{pillText}</span>
            <span className="mcp-server-tag">stdio</span>
            <span className="mcp-server-tag">trusted</span>
            <span>{toolCount} tool{toolCount === 1 ? '' : 's'}</span>
            {lastError ? <span className="mcp-server-err">{lastError}</span> : null}
          </span>
        </div>
        {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="mcp-builtin-regen"
        onClick={(e) => { e.stopPropagation(); onRegenerate() }}
        disabled={busy}
        title="Generate a new auth token. Open agent panes need to restart to pick it up."
      >
        <RotateCw size={11} className={busy ? 'usage-spin' : ''} aria-hidden="true" />
        {busy ? 'Regenerating…' : 'Regenerate token'}
      </button>
      {expanded && tools.length > 0 ? (
        <div className="mcp-builtin-tools">
          <div className="mcp-builtin-tools-title">Tools exposed to agent CLIs (call via MCP)</div>
          <ul>
            {tools.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code>
                <span>{tool.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {notice ? (
        <div className="mcp-builtin-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={onDismissNotice} aria-label="Dismiss notice">
            <X size={11} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

interface McpServerRowProps {
  server: McpServer
  busy: boolean
  expanded: boolean
  onToggle: () => void
  onStart: () => void
  trustPrompt: boolean
  removePrompt: boolean
  onTrustAndStart: () => void
  onCancelTrust: () => void
  onStop: () => void
  onRemove: () => void
  onCancelRemove: () => void
}

function McpServerRow({ server, busy, expanded, trustPrompt, removePrompt, onToggle, onStart, onTrustAndStart, onCancelTrust, onStop, onRemove, onCancelRemove }: McpServerRowProps): ReactElement {
  const isRunning = server.health === 'healthy' || server.health === 'starting'
  return (
    <div className={`mcp-server-row health-${server.health}${expanded ? ' expanded' : ''}`}>
      <button type="button" className="mcp-server-main" onClick={onToggle} aria-expanded={expanded}>
        <HealthIndicator status={server.health} />
        <div className="mcp-server-body">
          <strong>{server.name}</strong>
          <span className="mcp-server-meta">
            <span className="mcp-server-tag">{server.transport}</span>
            {server.workspaceId ? <span className="mcp-server-tag scope-ws">workspace</span> : <span className="mcp-server-tag scope-global">global</span>}
            {server.trusted ? <span className="mcp-server-tag">trusted</span> : <span className="mcp-server-tag">review required</span>}
            {server.tools.length > 0 ? <span>{server.tools.length} tool{server.tools.length !== 1 ? 's' : ''}</span> : null}
            {server.healthMessage ? <span className="mcp-server-err">{server.healthMessage}</span> : null}
          </span>
        </div>
        {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      </button>

      <div className="mcp-server-actions">
        {isRunning ? (
          <button type="button" className="ghost-btn small" disabled={busy} onClick={onStop} title="Stop">
            <Square size={11} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button type="button" className="primary-btn small" disabled={busy} onClick={onStart} title="Start handshake">
            <Play size={11} aria-hidden="true" /> Start
          </button>
        )}
        <button type="button" className="icon-button" aria-label="Remove" disabled={busy} onClick={onRemove}>
          <Trash2 size={11} aria-hidden="true" />
        </button>
      </div>

      {expanded ? (
        <div className="mcp-server-detail">
          {!server.trusted ? (
            <div className="mcp-server-trust-box">
              <ShieldCheck size={13} aria-hidden="true" />
              <span>Review command, args and env before starting. MCP servers can execute local code.</span>
            </div>
          ) : null}
          {trustPrompt ? (
            <div className="mcp-inline-confirm">
              <span>Trust this server and start now?</span>
              <button type="button" className="ghost-btn small" disabled={busy} onClick={onCancelTrust}>Cancel</button>
              <button type="button" className="primary-btn small" disabled={busy} onClick={onTrustAndStart}>Trust and start</button>
            </div>
          ) : null}
          {removePrompt ? (
            <div className="mcp-inline-confirm">
              <span>Remove "{server.name}"?</span>
              <button type="button" className="ghost-btn small" disabled={busy} onClick={onCancelRemove}>Cancel</button>
              <button type="button" className="primary-btn small" disabled={busy} onClick={onRemove}>Remove</button>
            </div>
          ) : null}
          <div className="mcp-server-config">
            {server.transport === 'stdio' ? (
              <>
                <code><strong>command:</strong> {(server.config as McpStdioConfig).command}</code>
                {(server.config as McpStdioConfig).args.length > 0 ? (
                  <code><strong>args:</strong> {(server.config as McpStdioConfig).args.join(' ')}</code>
                ) : null}
                {Object.keys((server.config as McpStdioConfig).env).length > 0 ? (
                  <code><strong>env:</strong> {Object.keys((server.config as McpStdioConfig).env).join(', ')}</code>
                ) : null}
              </>
            ) : null}
          </div>
          {server.tools.length > 0 ? (
            <div className="mcp-server-tools">
              <div className="mcp-server-tools-header">Exposed tools</div>
              {server.tools.map((tool) => (
                <div key={tool.name} className="mcp-tool-card">
                  <strong>{tool.name}</strong>
                  <span>{tool.description}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mcp-server-no-tools">
              {isRunning ? 'Loading tools…' : 'Start the server to discover tools.'}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function HealthIndicator({ status }: { status: McpHealthStatus }): ReactElement {
  switch (status) {
    case 'healthy':
      return <CircleDot size={11} className="status-healthy" aria-label="healthy" />
    case 'starting':
      return <CircleDot size={11} className="bg-jobs-pulse status-running" aria-label="starting" />
    case 'unhealthy':
      return <Circle size={11} className="status-failed" aria-label="unhealthy" />
    case 'unknown':
    default:
      return <Circle size={11} className="status-killed" aria-label="unknown" />
  }
}

interface McpCreateFormProps {
  workspaceId: string | null
  onCancel: () => void
  onCreated: () => void
}

// Onda 6: presets for the most common MCP servers so users don't have to
// remember `npx -y @playwright/mcp@latest`. Selecting a template just fills the
// fields — the user can edit before saving. "Custom" leaves everything blank.
const MCP_TEMPLATES: Array<{
  id: string
  label: string
  category: 'Core' | 'Coding' | 'Browser' | 'Docs' | 'Data' | 'Planning'
  description: string
  fill?: { name: string; command: string; argsText: string; envText?: string }
}> = [
  { id: 'custom', label: 'Custom', category: 'Core', description: 'Empty form — fill manually' },
  {
    id: 'filesystem',
    label: 'Filesystem',
    category: 'Core',
    description: 'Read/write files inside this workspace',
    fill: { name: 'filesystem', command: 'npx', argsText: '-y @modelcontextprotocol/server-filesystem .' }
  },
  {
    id: 'playwright',
    label: 'Playwright',
    category: 'Browser',
    description: 'Browser automation, screenshots and UI testing',
    fill: { name: 'playwright', command: 'npx', argsText: '-y @playwright/mcp@latest' }
  },
  {
    id: 'github',
    label: 'GitHub',
    category: 'Coding',
    description: 'Issues, PRs, repos and GitHub API operations',
    fill: { name: 'github', command: 'npx', argsText: '-y @modelcontextprotocol/server-github', envText: 'GITHUB_PERSONAL_ACCESS_TOKEN=' }
  },
  {
    id: 'git',
    label: 'Git',
    category: 'Coding',
    description: 'Local Git repository operations',
    fill: { name: 'git', command: 'uvx', argsText: 'mcp-server-git --repository .' }
  },
  {
    id: 'context7',
    label: 'Context7',
    category: 'Docs',
    description: 'Up-to-date library and framework documentation',
    fill: { name: 'context7', command: 'npx', argsText: '-y @upstash/context7-mcp' }
  },
  {
    id: 'fetch',
    label: 'Fetch',
    category: 'Docs',
    description: 'Fetch URLs and return clean Markdown for agents',
    fill: { name: 'fetch', command: 'npx', argsText: '-y @modelcontextprotocol/server-fetch' }
  },
  {
    id: 'sequential-thinking',
    label: 'Sequential Thinking',
    category: 'Planning',
    description: 'Structured multi-step reasoning for ambiguous tasks',
    fill: { name: 'sequential-thinking', command: 'npx', argsText: '-y @modelcontextprotocol/server-sequential-thinking' }
  },
  {
    id: 'memory',
    label: 'Memory',
    category: 'Planning',
    description: 'Persistent lightweight memory graph for long-running work',
    fill: { name: 'memory', command: 'npx', argsText: '-y @modelcontextprotocol/server-memory' }
  },
  {
    id: 'postgres',
    label: 'Postgres',
    category: 'Data',
    description: 'Inspect and query a Postgres database',
    fill: { name: 'postgres', command: 'npx', argsText: '-y @modelcontextprotocol/server-postgres postgresql://user:password@localhost:5432/database' }
  }
]

const MCP_TEMPLATE_CATEGORIES: Array<(typeof MCP_TEMPLATES)[number]['category']> = ['Core', 'Coding', 'Browser', 'Docs', 'Data', 'Planning']

const JSON_PLACEHOLDER = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}`

function McpCreateForm({ workspaceId, onCancel, onCreated }: McpCreateFormProps): ReactElement {
  const create = useMcpStore((s) => s.create)
  // Two entry modes: the guided "Form" with templates + per-field inputs, and
  // a free-form "JSON" tab that accepts the canonical mcpServers shape (the
  // same one Claude Code / Copilot CLI write to .mcp.json). The JSON tab makes
  // it trivial to paste an example from a README and create the server with
  // zero translation by the user.
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [templateId, setTemplateId] = useState('custom')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')
  const [scope, setScope] = useState<'global' | 'workspace'>(workspaceId ? 'workspace' : 'global')
  const [jsonText, setJsonText] = useState('')
  const [jsonName, setJsonName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyTemplate = (id: string): void => {
    setTemplateId(id)
    const tpl = MCP_TEMPLATES.find((t) => t.id === id)
    if (!tpl || !tpl.fill) return
    setName(tpl.fill.name)
    setCommand(tpl.fill.command)
    setArgsText(tpl.fill.argsText)
    setEnvText(tpl.fill.envText ?? '')
    setError(null)
  }

  const parsedArgs = useMemo(() => argsText.trim() ? argsText.trim().split(/\s+/) : [], [argsText])
  const parsedEnv = useMemo(() => {
    const out: Record<string, string> = {}
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.includes('=')) continue
      const eq = trimmed.indexOf('=')
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (!key || !value) continue
      out[key] = value
    }
    return out
  }, [envText])

  const handleSubmit = async (): Promise<void> => {
    setError(null)
    if (!name.trim() || !command.trim()) {
      setError('Name and command are required.')
      return
    }
    setBusy(true)
    try {
      const input: CreateMcpServerInput = {
        workspaceId: scope === 'workspace' ? workspaceId : null,
        name: name.trim(),
        transport: 'stdio',
        config: { transport: 'stdio', command: command.trim(), args: parsedArgs, env: parsedEnv },
        enabled: true,
        trusted: false
      }
      await create(input)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleJsonSubmit = async (): Promise<void> => {
    setError(null)
    let entries
    try {
      entries = parseMcpJson(jsonText)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    // Anonymous { command, args, env } needs a name; ask the form for one
    // (`jsonName`). Multi-entry JSON brings its own names — those wins.
    if (entries.length === 1 && !entries[0].name && !jsonName.trim()) {
      setError('Give the server a name (it was not in the JSON).')
      return
    }
    setBusy(true)
    try {
      for (const entry of entries) {
        await create({
          workspaceId: scope === 'workspace' ? workspaceId : null,
          name: entry.name || jsonName.trim(),
          transport: 'stdio',
          config: entry.config,
          enabled: true,
          trusted: false
        })
      }
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const selectedTemplate = MCP_TEMPLATES.find((t) => t.id === templateId) ?? MCP_TEMPLATES[0]

  return (
    <form
      className="mcp-create-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (mode === 'json') void handleJsonSubmit()
        else void handleSubmit()
      }}
    >
      {/* Mode toggle — Form vs JSON. JSON accepts the same shape that ships
          in Claude Code's .mcp.json (and what most MCP server READMEs print)
          so users can paste an example verbatim. */}
      <div className="mcp-create-mode-toggle" role="tablist" aria-label="Input mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'form'}
          className={`mcp-create-mode-tab${mode === 'form' ? ' active' : ''}`}
          onClick={() => { setMode('form'); setError(null) }}
          disabled={busy}
        >
          Form
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'json'}
          className={`mcp-create-mode-tab${mode === 'json' ? ' active' : ''}`}
          onClick={() => { setMode('json'); setError(null) }}
          disabled={busy}
          data-testid="mcp-create-mode-json"
        >
          JSON
        </button>
      </div>

      {mode === 'form' ? (
        <>
          <div className="mcp-create-template-field">
            <label htmlFor="mcp-template-select">Template</label>
            <select
              id="mcp-template-select"
              value={templateId}
              onChange={(event) => applyTemplate(event.currentTarget.value)}
              disabled={busy}
            >
              {MCP_TEMPLATE_CATEGORIES.map((category) => (
                <optgroup key={category} label={category}>
                  {MCP_TEMPLATES.filter((t) => t.category === category).map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="mcp-create-template-hint">
              <strong>{selectedTemplate.category}</strong> · {selectedTemplate.description}
            </span>
          </div>
          <div className="mcp-create-row">
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="filesystem" disabled={busy} />
            </label>
            <label>
              Scope
              <select value={scope} onChange={(event) => setScope(event.currentTarget.value as typeof scope)} disabled={busy || !workspaceId}>
                <option value="global">Global</option>
                {workspaceId ? <option value="workspace">This workspace only</option> : null}
              </select>
            </label>
          </div>
          <label>
            Command
            <input value={command} onChange={(event) => setCommand(event.currentTarget.value)} placeholder="npx" disabled={busy} />
          </label>
          <label>
            Args (space-separated)
            <input value={argsText} onChange={(event) => setArgsText(event.currentTarget.value)} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" disabled={busy} />
          </label>
          <label>
            Env (KEY=VAL, one per line — optional)
            <textarea value={envText} onChange={(event) => setEnvText(event.currentTarget.value)} placeholder={'GITHUB_TOKEN=ghp_...\nDEBUG=1'} rows={3} disabled={busy} />
          </label>
        </>
      ) : (
        <>
          <div className="mcp-create-row">
            <label>
              Scope
              <select value={scope} onChange={(event) => setScope(event.currentTarget.value as typeof scope)} disabled={busy || !workspaceId}>
                <option value="global">Global</option>
                {workspaceId ? <option value="workspace">This workspace only</option> : null}
              </select>
            </label>
            <label>
              Name (only if JSON omits it)
              <input
                value={jsonName}
                onChange={(event) => setJsonName(event.currentTarget.value)}
                placeholder="github"
                disabled={busy}
              />
            </label>
          </div>
          <label>
            JSON config
            <textarea
              className="mcp-create-json-textarea"
              value={jsonText}
              onChange={(event) => setJsonText(event.currentTarget.value)}
              placeholder={JSON_PLACEHOLDER}
              rows={12}
              spellCheck={false}
              disabled={busy}
              data-testid="mcp-create-json-textarea"
            />
            <span className="mcp-create-template-hint">
              Accepts {'{ mcpServers: { name: { command, args, env } } }'}, {'{ name: { command, ... } }'}, or {'{ command, args, env }'}.
              Pasting from a server&apos;s README usually just works.
            </span>
          </label>
        </>
      )}

      {error ? <div className="mcp-create-error">{error}</div> : null}
      <div className="mcp-create-actions">
        <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        {mode === 'form' ? (
          <button type="submit" className="primary-btn" disabled={busy || !name.trim() || !command.trim()}>Add server</button>
        ) : (
          <button type="submit" className="primary-btn" disabled={busy || !jsonText.trim()}>Add from JSON</button>
        )}
      </div>
    </form>
  )
}
