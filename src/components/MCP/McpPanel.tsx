import { Activity, ChevronDown, ChevronRight, Circle, CircleDot, KeyRound, Plus, PlugZap, RotateCw, Search, ShieldCheck, Square, Trash2, Wrench, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { ToolPanel, Button, TextField, Select, TextArea } from '../../ui'
import type { CreateMcpServerInput, McpHealthStatus, McpHttpConfig, McpServer, McpStdioConfig } from '../../../shared/types/mcp'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'
import { parseMcpJson } from './parseMcpJson'
import { McpCatalog } from './McpCatalog'
import { McpImportPanel } from './McpImportPanel'
import { catalogConfig, envTemplate, type McpCatalogEntry } from './connectorCatalog'
import type { ThreadMcpServerStatus } from '../../../shared/types/thread'
import { ThreadMcpServerList } from '../Threads/ThreadMcpServerList'
import { humanizeError } from '../../utils/humanizeError'
import { AGENT_STATE_HINT, AGENT_STATE_LABEL, agentStatusFor, type McpAgentState } from './mcpAgentStatus'

interface FormInitial { name: string; command: string; argsText: string; envText: string; note?: string; requiredEnv?: string[]; /** Came from the curated catalog: trusted and tested as soon as it is saved. */ fromCatalog?: boolean; /** A remote catalog server: the values fill its headers. */ remote?: McpCatalogEntry }

interface McpPanelProps {
  workspaceId: string | null
  /** The servers the open Thread conversation's session loaded, from every source the provider reads. */
  conversationServers?: ThreadMcpServerStatus[]
  onClose: () => void
}

export function McpPanel({ workspaceId, conversationServers, onClose }: McpPanelProps): ReactElement {
  const serversSelector = useCallback(selectMcpServers(workspaceId), [workspaceId])
  const servers = useMcpStore(serversSelector).filter((server): server is McpServer => Boolean(server))
  const loading = useMcpStore((s) => s.loading)
  const error = useMcpStore((s) => s.error)
  const load = useMcpStore((s) => s.load)
  const testServer = useMcpStore((s) => s.test)
  const stopServer = useMcpStore((s) => s.stop)
  const removeServer = useMcpStore((s) => s.remove)
  const updateServer = useMcpStore((s) => s.update)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [view, setView] = useState<'conversation' | 'catalog' | 'installed'>(conversationServers?.length ? 'conversation' : 'catalog')
  const [catalogBusyId, setCatalogBusyId] = useState<string | null>(null)
  const [formInitial, setFormInitial] = useState<FormInitial | null>(null)
  const createServer = useMcpStore((s) => s.create)
  const [query, setQuery] = useState('')
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
      setBuiltInNotice(humanizeError(err, 'Failed to regenerate token'))
    } finally {
      setBuiltInBusy(false)
    }
  }

  // The built-in row is global (workspaceId NULL) + name === 'oxespace'.
  // Pull it out of the regular list so the special card renders once and
  // the rest of the panel doesn't try to edit/delete it.
  const builtInServer = servers.find((s) => s.workspaceId === null && s.name === 'oxespace') ?? null
  const otherServers = builtInServer ? servers.filter((s) => s.id !== builtInServer.id) : servers
  const visibleServers = otherServers.filter((server) => `${server.name} ${server.transport} ${server.health} ${server.workspaceId ? 'workspace' : 'global'}`.toLowerCase().includes(query.trim().toLowerCase()))

  // Catalog "+": servers without secrets are created right away; the rest open
  // the form pre-filled so the user can paste the token before saving.
  const handleCatalogAdd = async (entry: McpCatalogEntry): Promise<void> => {
    if (entry.requiredEnv?.length || entry.configure) {
      setFormInitial(entry.transport === 'stdio'
        ? { name: entry.id, command: entry.command, argsText: entry.args.join(' '), envText: envTemplate(entry), note: entry.configure, requiredEnv: entry.requiredEnv, fromCatalog: true }
        : { name: entry.id, command: '', argsText: '', envText: envTemplate(entry), note: entry.configure, requiredEnv: entry.requiredEnv, fromCatalog: true, remote: entry })
      setCreating(true)
      return
    }
    setCatalogBusyId(entry.id)
    try {
      // Catalog entries are curated, so one click adds, trusts and tests the server. A remote
      // server's sign-in is the agent's: it opens the browser the first time it connects.
      const config = catalogConfig(entry)
      const created = await createServer({ workspaceId, name: entry.id, transport: config.transport, config, enabled: true, trusted: true })
      void testServer(created.id).catch(() => undefined) // progress and errors show on the row
    } catch { /* error captured in store */ } finally { setCatalogBusyId(null) }
  }

  const handleTest = async (server: McpServer): Promise<void> => {
    if (!server.trusted) {
      setTrustPromptId(server.id)
      setExpandedId(server.id)
      return
    }
    setBusy(server.id)
    try { await testServer(server.id) } catch { /* error captured in store */ } finally { setBusy(null) }
  }

  const handleTrustAndTest = async (server: McpServer): Promise<void> => {
    setBusy(server.id)
    try {
      await updateServer({ id: server.id, trusted: true })
      await testServer(server.id)
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
    <ToolPanel
      className={`mcp-panel${view === 'catalog' ? ' is-catalog' : ''}`}
      label="MCP servers" onClose={onClose}>
      <header className="mcp-panel-header">
        <div className="mcp-panel-title">
          <Activity size={14} aria-hidden="true" />
          <strong>MCP servers</strong>
          <span className="mcp-panel-scope">{workspaceId ? 'workspace' : 'global'}</span>
        </div>
        <div className="mcp-panel-actions">
          <Button
           
            variant="ghost" size="sm" square
            aria-label="Refresh"
            disabled={loading}
            onClick={() => void load(workspaceId)}
          >
            <RotateCw size={14} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" square aria-label="Close" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      </header>

      {error ? <div className="mcp-panel-error">{error}</div> : null}

      <label className="mcp-panel-search">
        <Search size={14} aria-hidden="true" />
        <TextField type="search" aria-label="Search MCP servers" placeholder="Search connections" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      {view === 'installed' && (
        <p className="mcp-panel-sync-note">
          Your agents connect to these servers themselves: Claude Code and Copilot CLI through
          <code>.mcp.json</code> at the workspace root, Codex through its launch settings. Test checks that a
          server answers; whether the agent connected shows next to it in a Thread conversation. Restart the
          agent session to pick up changes.
        </p>
      )}

      {creating ? (
        <McpCreateForm
          workspaceId={workspaceId}
          initial={formInitial ?? undefined}
          onCancel={() => { setCreating(false); setFormInitial(null) }}
          onCreated={() => { setCreating(false); setFormInitial(null); setView('installed') }}
        />
      ) : importing ? (
        <McpImportPanel workspaceId={workspaceId} onClose={() => setImporting(false)} onChanged={() => void load(workspaceId)} onImported={() => { setImporting(false); void load(workspaceId); setView('installed') }} />
      ) : (
        <>
          <button type="button" className="mcp-panel-add" onClick={() => setCreating(true)}>
            <Plus size={12} aria-hidden="true" />
            Add MCP server
          </button>
          {window.oxe?.mcp?.discover && <button type="button" className="mcp-panel-add" onClick={() => setImporting(true)}>
            <Plus size={12} aria-hidden="true" />
            Import from Claude Desktop, Cursor or Windsurf
          </button>}
        </>
      )}

      <div className="mcp-view-tabs" role="tablist" aria-label="MCP servers view">
        {conversationServers?.length ? <button type="button" role="tab" aria-selected={view === 'conversation'} onClick={() => setView('conversation')}>This conversation<small>{conversationServers.filter(server => server.status === 'connected').length}</small></button> : null}
        <button type="button" role="tab" aria-selected={view === 'catalog'} onClick={() => setView('catalog')}>Catalog</button>
        <button type="button" role="tab" aria-selected={view === 'installed'} onClick={() => setView('installed')}>Installed<small>{otherServers.length + (builtInServer ? 1 : 0)}</small></button>
      </div>

      {view === 'conversation' && conversationServers ? (
        <div className="mcp-panel-list mcp-panel-conversation">
          <p className="mcp-panel-sync-note">What the agent of this conversation loaded when its session started: servers from OXESpace, your provider settings, the project's <code>.mcp.json</code> and claude.ai connectors. Changes apply to the next session.</p>
          <ThreadMcpServerList servers={conversationServers.filter(server => `${server.name} ${server.status}`.toLowerCase().includes(query.trim().toLowerCase()))} />
        </div>
      ) : view === 'catalog' ? (
        <div className="mcp-panel-list">
          <McpCatalog servers={otherServers} query={query} busyId={catalogBusyId} onAdd={(entry) => void handleCatalogAdd(entry)} onTest={(server) => void handleTest(server)} />
        </div>
      ) : (
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
        {visibleServers.length === 0 && !creating ? (
          <div className="mcp-panel-empty">
            <Wrench size={32} aria-hidden="true" />
            <strong>{query ? 'No matching connections' : 'No additional MCP servers'}</strong>
            <span>{query ? 'Try another name or status.' : 'Add a workspace server when your agents need more tools.'}</span>
          </div>
        ) : (
          visibleServers.map((server) => (
            <McpServerRow
              key={server.id}
              server={server}
              agentState={agentStatusFor(server.name, conversationServers)}
              busy={busy === server.id}
              expanded={expandedId === server.id}
              onToggle={() => setExpandedId(expandedId === server.id ? null : server.id)}
              trustPrompt={trustPromptId === server.id}
              removePrompt={removePromptId === server.id}
              onTrustAndTest={() => void handleTrustAndTest(server)}
              onCancelTrust={() => setTrustPromptId(null)}
              onTest={() => void handleTest(server)}
              onStop={() => void handleStop(server.id)}
              onRemove={() => void handleRemove(server)}
              onCancelRemove={() => setRemovePromptId(null)}
            />
          ))
        )}
      </div>
      )}

      <footer className="mcp-panel-footer">
        Agents run these servers themselves. Remote connectors sign in through your browser the first time the agent connects.
      </footer>
    </ToolPanel>
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
        <RotateCw size={12} className={busy ? 'usage-spin' : ''} aria-hidden="true" />
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
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

interface McpServerRowProps {
  server: McpServer
  agentState: McpAgentState
  busy: boolean
  expanded: boolean
  onToggle: () => void
  onTest: () => void
  trustPrompt: boolean
  removePrompt: boolean
  onTrustAndTest: () => void
  onCancelTrust: () => void
  onStop: () => void
  onRemove: () => void
  onCancelRemove: () => void
}

/** What OXESpace's own test found; the agent's connection is reported separately. */
const TEST_LABEL: Record<McpHealthStatus, string> = { unknown: 'Not tested', starting: 'Testing…', healthy: 'Answers', 'needs-auth': 'Answers · sign-in', unhealthy: 'Test failed' }

function McpServerRow({ server, agentState, busy, expanded, trustPrompt, removePrompt, onToggle, onTest, onTrustAndTest, onCancelTrust, onStop, onRemove, onCancelRemove }: McpServerRowProps): ReactElement {
  const testing = server.health === 'starting'
  const remote = server.config.transport !== 'stdio'
  return (
    <div className={`mcp-server-row health-${server.health}${expanded ? ' expanded' : ''}`}>
      <button type="button" className="mcp-server-main" onClick={onToggle} aria-expanded={expanded}>
        <HealthIndicator status={server.health} />
        <div className="mcp-server-body">
          <strong>{server.name}</strong>
          <span className="mcp-server-meta">
            <span className={`mcp-server-tag mcp-agent-state is-${agentState}`} title={AGENT_STATE_HINT[agentState]}>{AGENT_STATE_LABEL[agentState]}</span>
            <span className="mcp-server-tag" title={server.testedAtMs ? `OXESpace tested it at ${new Date(server.testedAtMs).toLocaleTimeString()}` : 'OXESpace has not tested it since it opened'}>{TEST_LABEL[server.health]}</span>
            <span className="mcp-server-tag">{server.transport}</span>
            {server.workspaceId ? <span className="mcp-server-tag scope-ws">workspace</span> : <span className="mcp-server-tag scope-global">global</span>}
            {server.trusted ? <span className="mcp-server-tag">trusted</span> : <span className="mcp-server-tag">review required</span>}
            {server.tools.length > 0 ? <span>{server.tools.length} tool{server.tools.length !== 1 ? 's' : ''}</span> : null}
            {server.healthMessage && server.health !== 'healthy' ? <span className={server.health === 'unhealthy' ? 'mcp-server-err' : undefined}>{server.healthMessage}</span> : null}
          </span>
        </div>
        {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      </button>

      <div className="mcp-server-actions">
        {testing ? (
          <Button variant="ghost" size="sm" onClick={onStop} title="Stop the test">
            <Square size={12} aria-hidden="true" /> Stop
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onTest} title="Check that the server answers and list its tools. The agent keeps its own connection.">
            <PlugZap size={12} aria-hidden="true" /> Test
          </Button>
        )}
        <Button variant="ghost" size="sm" square aria-label="Remove" disabled={busy} onClick={onRemove}>
          <Trash2 size={12} aria-hidden="true" />
        </Button>
      </div>

      {expanded ? (
        <div className="mcp-server-detail">
          {!server.trusted ? (
            <div className="mcp-server-trust-box">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>Review command, args and env before starting. MCP servers can execute local code.</span>
            </div>
          ) : null}
          {trustPrompt ? (
            <div className="mcp-inline-confirm">
              <span>Trust this server and test it now?</span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onCancelTrust}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={onTrustAndTest}>Trust and test</Button>
            </div>
          ) : null}
          {removePrompt ? (
            <div className="mcp-inline-confirm">
              <span>Remove "{server.name}"?</span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onCancelRemove}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={onRemove}>Remove</Button>
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
            ) : (
              <>
                <code><strong>url:</strong> {(server.config as McpHttpConfig).url}</code>
                {Object.keys((server.config as McpHttpConfig).headers ?? {}).length > 0 ? (
                  <code><strong>headers:</strong> {Object.keys((server.config as McpHttpConfig).headers).join(', ')}</code>
                ) : null}
              </>
            )}
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
              {testing ? 'Loading tools…' : server.health === 'needs-auth' || (remote && server.health === 'healthy') ? 'Its tools show once the agent signs in and connects.' : 'Test the server to list its tools.'}
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
      return <CircleDot size={12} className="status-healthy" aria-label="healthy" />
    case 'starting':
      return <CircleDot size={12} className="bg-jobs-pulse status-running" aria-label="testing" />
    case 'needs-auth':
      return <KeyRound size={12} className="status-running" aria-label="answers, needs sign-in" />
    case 'unhealthy':
      return <Circle size={12} className="status-failed" aria-label="unhealthy" />
    case 'unknown':
    default:
      return <Circle size={12} className="status-killed" aria-label="unknown" />
  }
}

interface McpCreateFormProps {
  workspaceId: string | null
  onCancel: () => void
  onCreated: () => void
  /** Values pre-filled by the connector catalog. */
  initial?: FormInitial
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

function McpCreateForm({ workspaceId, initial, onCancel, onCreated }: McpCreateFormProps): ReactElement {
  const create = useMcpStore((s) => s.create)
  // Two entry modes: the guided "Form" with templates + per-field inputs, and
  // a free-form "JSON" tab that accepts the canonical mcpServers shape (the
  // same one Claude Code / Copilot CLI write to .mcp.json). The JSON tab makes
  // it trivial to paste an example from a README and create the server with
  // zero translation by the user.
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [templateId, setTemplateId] = useState('custom')
  const [name, setName] = useState(initial?.name ?? '')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [argsText, setArgsText] = useState(initial?.argsText ?? '')
  const [envText, setEnvText] = useState(initial?.envText ?? '')
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

  const remote = initial?.remote
  const handleSubmit = async (): Promise<void> => {
    setError(null)
    if (!name.trim() || (!remote && !command.trim())) {
      setError('Name and command are required.')
      return
    }
    const placeholder = /<[^<>s]+>/.exec(argsText)
    if (placeholder) { setError(`Replace ${placeholder[0]} with a real value before saving.`); return }
    const missing = (initial?.requiredEnv ?? []).filter(key => !parsedEnv[key])
    if (missing.length) { setError(`Fill in ${missing.join(', ')} before saving.`); return }
    setBusy(true)
    try {
      // A remote catalog server takes the values into its headers; the agent connects to the URL itself.
      const config = remote ? catalogConfig(remote, parsedEnv) : { transport: 'stdio' as const, command: command.trim(), args: parsedArgs, env: parsedEnv }
      const input: CreateMcpServerInput = {
        workspaceId: scope === 'workspace' ? workspaceId : null,
        name: name.trim(),
        transport: config.transport,
        config,
        enabled: true,
        trusted: initial?.fromCatalog === true
      }
      const created = await create(input)
      if (initial?.fromCatalog) void useMcpStore.getState().test(created.id).catch(() => undefined)
      onCreated()
    } catch (err) {
      setError(humanizeError(err))
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
      setError(humanizeError(err))
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
          transport: entry.config.transport,
          config: entry.config,
          enabled: true,
          trusted: false
        })
      }
      onCreated()
    } catch (err) {
      setError(humanizeError(err))
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
      {initial?.note && <p className="mcp-create-note" role="note">{initial.note}</p>}
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
            <Select
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
            </Select>
            <span className="mcp-create-template-hint">
              <strong>{selectedTemplate.category}</strong> · {selectedTemplate.description}
            </span>
          </div>
          <div className="mcp-create-row">
            <label>
              Name
              <TextField value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="filesystem" disabled={busy} />
            </label>
            <label>
              Scope
              <Select value={scope} onChange={(event) => setScope(event.currentTarget.value as typeof scope)} disabled={busy || !workspaceId}>
                <option value="global">Global</option>
                {workspaceId ? <option value="workspace">This workspace only</option> : null}
              </Select>
            </label>
          </div>
          {remote && remote.transport !== 'stdio' ? (
            <label>
              URL
              <TextField value={remote.url} readOnly disabled={busy} />
            </label>
          ) : (
            <>
              <label>
                Command
                <TextField value={command} onChange={(event) => setCommand(event.currentTarget.value)} placeholder="npx" disabled={busy} />
              </label>
              <label>
                Args (space-separated)
                <TextField value={argsText} onChange={(event) => setArgsText(event.currentTarget.value)} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" disabled={busy} />
              </label>
            </>
          )}
          <label>
            {remote ? 'Values (KEY=VAL, one per line; sent in the request headers)' : 'Env (KEY=VAL, one per line — optional)'}
            <TextArea value={envText} onChange={(event) => setEnvText(event.currentTarget.value)} placeholder={'GITHUB_TOKEN=ghp_...\nDEBUG=1'} rows={3} disabled={busy} />
          </label>
        </>
      ) : (
        <>
          <div className="mcp-create-row">
            <label>
              Scope
              <Select value={scope} onChange={(event) => setScope(event.currentTarget.value as typeof scope)} disabled={busy || !workspaceId}>
                <option value="global">Global</option>
                {workspaceId ? <option value="workspace">This workspace only</option> : null}
              </Select>
            </label>
            <label>
              Name (only if JSON omits it)
              <TextField
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
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        {mode === 'form' ? (
          <Button type="submit" variant="primary" disabled={busy || !name.trim() || (!remote && !command.trim())}>Add server</Button>
        ) : (
          <Button type="submit" variant="primary" disabled={busy || !jsonText.trim()}>Add from JSON</Button>
        )}
      </div>
    </form>
  )
}
