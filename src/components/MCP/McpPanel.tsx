import { Activity, ChevronDown, ChevronRight, Circle, CircleDot, Play, Plus, RotateCw, ShieldCheck, Square, Trash2, Wrench, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { CreateMcpServerInput, McpHealthStatus, McpServer, McpStdioConfig } from '../../../shared/types/mcp'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'

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

  useEffect(() => { void load(workspaceId) }, [workspaceId, load])

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
          {servers.length === 0 && !creating ? (
            <div className="mcp-panel-empty">
              <Wrench size={32} aria-hidden="true" />
              <strong>No MCP server configured</strong>
              <span>Add a server to expose filesystem, GitHub, database tools to your agents.</span>
            </div>
          ) : (
            servers.map((server) => (
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
  description: string
  fill?: { name: string; command: string; argsText: string; envText?: string }
}> = [
  { id: 'custom', label: 'Custom', description: 'Empty form — fill manually' },
  { id: 'playwright', label: 'Playwright', description: 'Browser automation via @playwright/mcp', fill: { name: 'playwright', command: 'npx', argsText: '-y @playwright/mcp@latest' } },
  { id: 'filesystem', label: 'Filesystem', description: 'Read/write files in a directory', fill: { name: 'filesystem', command: 'npx', argsText: '-y @modelcontextprotocol/server-filesystem .' } },
  { id: 'github', label: 'GitHub', description: 'GitHub API operations (issues, PRs, repos)', fill: { name: 'github', command: 'npx', argsText: '-y @modelcontextprotocol/server-github', envText: 'GITHUB_PERSONAL_ACCESS_TOKEN=' } },
  { id: 'git', label: 'Git', description: 'Local git repo operations via uvx', fill: { name: 'git', command: 'uvx', argsText: 'mcp-server-git --repository .' } }
]

function McpCreateForm({ workspaceId, onCancel, onCreated }: McpCreateFormProps): ReactElement {
  const create = useMcpStore((s) => s.create)
  const [templateId, setTemplateId] = useState('custom')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')
  const [scope, setScope] = useState<'global' | 'workspace'>(workspaceId ? 'workspace' : 'global')
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
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
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

  const selectedTemplate = MCP_TEMPLATES.find((t) => t.id === templateId) ?? MCP_TEMPLATES[0]

  return (
    <form className="mcp-create-form" onSubmit={(event) => { event.preventDefault(); void handleSubmit() }}>
      <div className="mcp-create-template-field">
        <label htmlFor="mcp-template-select">Template</label>
        <select
          id="mcp-template-select"
          value={templateId}
          onChange={(event) => applyTemplate(event.currentTarget.value)}
          disabled={busy}
        >
          {MCP_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <span className="mcp-create-template-hint">{selectedTemplate.description}</span>
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
      {error ? <div className="mcp-create-error">{error}</div> : null}
      <div className="mcp-create-actions">
        <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="primary-btn" disabled={busy || !name.trim() || !command.trim()}>Add server</button>
      </div>
    </form>
  )
}
