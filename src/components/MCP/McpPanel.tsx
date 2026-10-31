import { Activity, ChevronDown, ChevronRight, Circle, CircleDot, KeyRound, Plus, PlugZap, RotateCw, Search, ShieldCheck, Square, Trash2, Wrench, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { ToolPanel, Button, ConfirmDialog, EmptyState, ErrorState, TextField, Select, TextArea } from '../../ui'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')
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
import { formatClock } from '../../utils/formatTime'
import { RichText } from '../../i18n/RichText'
import { McpServerSafety } from './McpServerSafety'

interface FormInitial { name: string; command: string; argsText: string; envText: string; note?: string; requiredEnv?: string[]; /** Came from the curated catalog: trusted and tested as soon as it is saved. */ fromCatalog?: boolean; /** A remote catalog server: the values fill its headers. */ remote?: McpCatalogEntry }

interface McpPanelProps {
  workspaceId: string | null
  /** The servers the open Thread conversation's session loaded, from every source the provider reads. */
  conversationServers?: ThreadMcpServerStatus[]
  onClose: () => void
}

export function McpPanel({ workspaceId, conversationServers, onClose }: McpPanelProps): ReactElement {
  const { t } = useTranslation('code')
  // A new token breaks every running agent's connection until it restarts, so it is confirmed first.
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
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
      setBuiltInNotice(t('mcp.builtin.regenerated'))
    } catch (err) {
      setBuiltInNotice(humanizeError(err, t('mcp.builtin.regenerateFailed')))
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
      label={t('tools.mcp.label')} onClose={onClose}>
      <header className="mcp-panel-header">
        <div className="mcp-panel-title">
          <Activity size={14} aria-hidden="true" />
          <strong>{t('tools.mcp.label')}</strong>
          <span className="mcp-panel-scope">{workspaceId ? t('mcp.scope.workspace') : t('mcp.scope.global')}</span>
        </div>
        <div className="mcp-panel-actions">
          <Button
           
            variant="ghost" size="sm" square
            aria-label={t('github.refresh')}
            title={t('github.refresh')}
            disabled={loading}
            onClick={() => void load(workspaceId)}
          >
            <RotateCw size={14} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" square aria-label={t('mcp.close')} title={t('mcp.close')} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      </header>

      {error ? <ErrorState compact title={t('mcp.failed')} message={error} onRetry={() => void load(workspaceId)} /> : null}

      <label className="mcp-panel-search">
        <Search size={14} aria-hidden="true" />
        <TextField type="search" aria-label={t('mcp.search')} placeholder={t('mcp.searchPlaceholder')} value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      {view === 'installed' && (
        <p className="mcp-panel-sync-note"><RichText text={t('mcp.installedNote')} /></p>
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
            {t('mcp.add')}
          </button>
          {window.oxe?.mcp?.discover && <button type="button" className="mcp-panel-add" onClick={() => setImporting(true)}>
            <Plus size={12} aria-hidden="true" />
            {t('mcp.importOpen')}
          </button>}
        </>
      )}

      <div className="mcp-view-tabs" role="tablist" aria-label={t('mcp.views')}>
        {conversationServers?.length ? <button type="button" role="tab" aria-selected={view === 'conversation'} onClick={() => setView('conversation')}>{t('mcp.view.conversation')}<small>{conversationServers.filter(server => server.status === 'connected').length}</small></button> : null}
        <button type="button" role="tab" aria-selected={view === 'catalog'} onClick={() => setView('catalog')}>{t('mcp.view.catalog')}</button>
        <button type="button" role="tab" aria-selected={view === 'installed'} onClick={() => setView('installed')}>{t('mcp.view.installed')}<small>{otherServers.length + (builtInServer ? 1 : 0)}</small></button>
      </div>

      {view === 'conversation' && conversationServers ? (
        <div className="mcp-panel-list mcp-panel-conversation">
          <p className="mcp-panel-sync-note"><RichText text={t('mcp.conversationNote')} /></p>
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
          onRegenerate={() => setConfirmRegenerate(true)}
          onDismissNotice={() => setBuiltInNotice(null)}
        />
        {visibleServers.length === 0 && !creating ? (
          <EmptyState compact icon={<Wrench size={16} />} title={query ? t('mcp.noMatchInstalled') : t('mcp.noneInstalled')}>{query ? t('mcp.noMatchInstalledHint') : t('mcp.noneInstalledHint')}</EmptyState>
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

      <footer className="mcp-panel-footer">{t('mcp.footer')}</footer>
      {confirmRegenerate && <ConfirmDialog title={t('mcp.builtin.confirmTitle')} description={t('mcp.builtin.confirmBody')} confirmLabel={t('mcp.builtin.regenerate')}
        onCancel={() => setConfirmRegenerate(false)} onConfirm={() => { setConfirmRegenerate(false); void handleRegenerateToken() }} />}
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
    ? tc('mcp.builtin.error')
    : running
      ? port !== null
        ? `${tc('mcp.builtin.running')} · :${port}`
        : tc('mcp.builtin.running')
      : tc('mcp.builtin.stopped')
  return (
    <div className={`mcp-server-row mcp-builtin-row ${pillClass}${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="mcp-server-main"
        aria-label={tc('mcp.builtin.label')}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <HealthIndicator status={lastError ? 'unhealthy' : running ? 'healthy' : 'unknown'} />
        <div className="mcp-server-body">
          <strong>{tc('mcp.builtin.name')} <span className="mcp-server-tag scope-global">{tc('mcp.builtin.auto')}</span></strong>
          <span className="mcp-server-meta">
            <span className={`mcp-server-tag mcp-builtin-status ${running ? 'on' : 'off'}`}>{pillText}</span>
            <span className="mcp-server-tag">stdio</span>
            <span className="mcp-server-tag">{tc('mcp.trusted')}</span>
            <span>{tc('mcp.tools', { count: toolCount })}</span>
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
        aria-haspopup="dialog"
        title={tc('mcp.builtin.regenerateTitle')}
      >
        <RotateCw size={12} className={busy ? 'usage-spin' : ''} aria-hidden="true" />
        {busy ? tc('mcp.builtin.regenerating') : tc('mcp.builtin.regenerate')}
      </button>
      {expanded && tools.length > 0 ? (
        <div className="mcp-builtin-tools">
          <div className="mcp-builtin-tools-title">{tc('mcp.builtin.toolsTitle')}</div>
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
          <button type="button" onClick={onDismissNotice} aria-label={tc('worktree.dismiss')} title={tc('worktree.dismiss')}>
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
const testLabel = (health: McpHealthStatus): string => tc(`mcp.test.${health}`)

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
            <span className="mcp-server-tag" title={server.testedAtMs ? tc('mcp.testedAt', { time: formatClock(server.testedAtMs) }) : tc('mcp.notTested')}>{testLabel(server.health)}</span>
            <span className="mcp-server-tag">{server.transport}</span>
            {server.workspaceId ? <span className="mcp-server-tag scope-ws">{tc('mcp.scope.workspace')}</span> : <span className="mcp-server-tag scope-global">{tc('mcp.scope.global')}</span>}
            {server.trusted ? <span className="mcp-server-tag">{tc('mcp.trusted')}</span> : <span className="mcp-server-tag">{server.guard?.quarantine ? tc('mcp.quarantined') : tc('mcp.reviewRequired')}</span>}
            {server.tools.length > 0 ? <span>{tc('mcp.tools', { count: server.tools.length })}</span> : null}
            {server.healthMessage && server.health !== 'healthy' ? <span className={server.health === 'unhealthy' ? 'mcp-server-err' : undefined}>{server.healthMessage}</span> : null}
          </span>
        </div>
        {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      </button>

      <div className="mcp-server-actions">
        {testing ? (
          <Button variant="ghost" size="sm" onClick={onStop} title={tc('mcp.stopTest')}>
            <Square size={12} aria-hidden="true" /> {tc('background.stop')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onTest} title={tc('mcp.testServerTitle')}>
            <PlugZap size={12} aria-hidden="true" /> {tc('mcp.testButton')}
          </Button>
        )}
        <Button variant="ghost" size="sm" square aria-label={tc('mcp.removeLabel', { name: server.name })} title={tc('mcp.remove')} disabled={busy} onClick={onRemove}>
          <Trash2 size={12} aria-hidden="true" />
        </Button>
      </div>

      {expanded ? (
        <div className="mcp-server-detail">
          <McpServerSafety server={server} />
          {!server.trusted ? (
            <div className="mcp-server-trust-box">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>{tc('mcp.reviewHint')}</span>
            </div>
          ) : null}
          {trustPrompt ? (
            <div className="mcp-inline-confirm">
              <span>{tc('mcp.trustQuestion')}</span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onCancelTrust}>{tc('github.cancel')}</Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={onTrustAndTest}>{tc('mcp.trustAndTest')}</Button>
            </div>
          ) : null}
          {removePrompt ? (
            <div className="mcp-inline-confirm">
              <span>{tc('mcp.removeQuestion', { name: server.name })}</span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onCancelRemove}>{tc('github.cancel')}</Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={onRemove}>{tc('mcp.remove')}</Button>
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
              <div className="mcp-server-tools-header">{tc('mcp.exposedTools')}</div>
              {server.tools.map((tool) => (
                <div key={tool.name} className="mcp-tool-card">
                  <strong>{tool.name}</strong>
                  <span>{tool.description}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mcp-server-no-tools">
              {testing ? tc('mcp.loadingTools') : server.health === 'needs-auth' || (remote && server.health === 'healthy') ? tc('mcp.toolsAfterSignIn') : tc('mcp.testToList')}
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
      return <CircleDot size={12} className="status-healthy" role="img" aria-label={tc('mcp.indicator.healthy')} />
    case 'starting':
      return <CircleDot size={12} className="bg-jobs-pulse status-running" role="img" aria-label={tc('mcp.indicator.starting')} />
    case 'needs-auth':
      return <KeyRound size={12} className="status-running" role="img" aria-label={tc('mcp.indicator.needsAuth')} />
    case 'unhealthy':
      return <Circle size={12} className="status-failed" role="img" aria-label={tc('mcp.indicator.unhealthy')} />
    case 'unknown':
    default:
      return <Circle size={12} className="status-killed" role="img" aria-label={tc('mcp.indicator.unknown')} />
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
  /** Product name (the same in every language); Custom is translated. */
  name: string
  category: 'Core' | 'Coding' | 'Browser' | 'Docs' | 'Data' | 'Planning'
  fill?: { name: string; command: string; argsText: string; envText?: string }
}> = [
  { id: 'custom', name: 'custom', category: 'Core' },
  {
    id: 'filesystem',
    name: 'Filesystem',
    category: 'Core',
    fill: { name: 'filesystem', command: 'npx', argsText: '-y @modelcontextprotocol/server-filesystem .' }
  },
  {
    id: 'playwright',
    name: 'Playwright',
    category: 'Browser',
    fill: { name: 'playwright', command: 'npx', argsText: '-y @playwright/mcp@latest' }
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Coding',
    fill: { name: 'github', command: 'npx', argsText: '-y @modelcontextprotocol/server-github', envText: 'GITHUB_PERSONAL_ACCESS_TOKEN=' }
  },
  {
    id: 'git',
    name: 'Git',
    category: 'Coding',
    fill: { name: 'git', command: 'uvx', argsText: 'mcp-server-git --repository .' }
  },
  {
    id: 'context7',
    name: 'Context7',
    category: 'Docs',
    fill: { name: 'context7', command: 'npx', argsText: '-y @upstash/context7-mcp' }
  },
  {
    id: 'fetch',
    name: 'Fetch',
    category: 'Docs',
    fill: { name: 'fetch', command: 'npx', argsText: '-y @modelcontextprotocol/server-fetch' }
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    category: 'Planning',
    fill: { name: 'sequential-thinking', command: 'npx', argsText: '-y @modelcontextprotocol/server-sequential-thinking' }
  },
  {
    id: 'memory',
    name: 'Memory',
    category: 'Planning',
    fill: { name: 'memory', command: 'npx', argsText: '-y @modelcontextprotocol/server-memory' }
  },
  {
    id: 'postgres',
    name: 'Postgres',
    category: 'Data',
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
      setError(tc('mcp.form.required'))
      return
    }
    const placeholder = /<[^<>s]+>/.exec(argsText)
    if (placeholder) { setError(tc('mcp.form.placeholder', { value: placeholder[0] })); return }
    const missing = (initial?.requiredEnv ?? []).filter(key => !parsedEnv[key])
    if (missing.length) { setError(tc('mcp.form.missing', { names: missing.join(', ') })); return }
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
      setError(tc('mcp.form.jsonName'))
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
      <div className="mcp-create-mode-toggle" role="tablist" aria-label={tc('mcp.form.mode')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'form'}
          className={`mcp-create-mode-tab${mode === 'form' ? ' active' : ''}`}
          onClick={() => { setMode('form'); setError(null) }}
          disabled={busy}
        >
          {tc('mcp.form.formTab')}
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
            <label htmlFor="mcp-template-select">{tc('mcp.form.template')}</label>
            <Select
              id="mcp-template-select"
              value={templateId}
              onChange={(event) => applyTemplate(event.currentTarget.value)}
              disabled={busy}
            >
              {MCP_TEMPLATE_CATEGORIES.map((category) => (
                <optgroup key={category} label={tc(`mcp.form.category.${category}`)}>
                  {MCP_TEMPLATES.filter((t) => t.category === category).map((t) => (
                    <option key={t.id} value={t.id}>{t.id === 'custom' ? tc('mcp.form.custom') : t.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <span className="mcp-create-template-hint">
              <strong>{tc(`mcp.form.category.${selectedTemplate.category}`)}</strong> · {tc(`mcp.form.templates.${selectedTemplate.id as 'custom'}`)}
            </span>
          </div>
          <div className="mcp-create-row">
            <label>
              {tc('mcp.form.name')}
              <TextField value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="filesystem" disabled={busy} />
            </label>
            <label>
              {tc('mcp.form.scope')}
              <Select value={scope} onChange={(event) => setScope(event.currentTarget.value as typeof scope)} disabled={busy || !workspaceId}>
                <option value="global">{tc('mcp.form.global')}</option>
                {workspaceId ? <option value="workspace">{tc('mcp.form.workspaceOnly')}</option> : null}
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
                {tc('mcp.form.command')}
                <TextField value={command} onChange={(event) => setCommand(event.currentTarget.value)} placeholder="npx" disabled={busy} />
              </label>
              <label>
                {tc('mcp.form.args')}
                <TextField value={argsText} onChange={(event) => setArgsText(event.currentTarget.value)} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" disabled={busy} />
              </label>
            </>
          )}
          <label>
            {remote ? tc('mcp.form.values') : tc('mcp.form.env')}
            <TextArea value={envText} onChange={(event) => setEnvText(event.currentTarget.value)} placeholder={'GITHUB_TOKEN=ghp_...\nDEBUG=1'} rows={3} disabled={busy} />
          </label>
        </>
      ) : (
        <>
          <div className="mcp-create-row">
            <label>
              {tc('mcp.form.scope')}
              <Select value={scope} onChange={(event) => setScope(event.currentTarget.value as typeof scope)} disabled={busy || !workspaceId}>
                <option value="global">{tc('mcp.form.global')}</option>
                {workspaceId ? <option value="workspace">{tc('mcp.form.workspaceOnly')}</option> : null}
              </Select>
            </label>
            <label>
              {tc('mcp.form.jsonNameLabel')}
              <TextField
                value={jsonName}
                onChange={(event) => setJsonName(event.currentTarget.value)}
                placeholder="github"
                disabled={busy}
              />
            </label>
          </div>
          <label>
            {tc('mcp.form.json')}
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
            <span className="mcp-create-template-hint">{tc('mcp.form.jsonHint', { a: '{ mcpServers: { name: { command, args, env } } }', b: '{ name: { command, ... } }', c: '{ command, args, env }' })}</span>
          </label>
        </>
      )}

      {error ? <ErrorState compact title={tc('mcp.form.failed')} message={error} /> : null}
      <div className="mcp-create-actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{tc('github.cancel')}</Button>
        {mode === 'form' ? (
          <Button type="submit" variant="primary" disabled={busy || !name.trim() || (!remote && !command.trim())}>{tc('mcp.form.add')}</Button>
        ) : (
          <Button type="submit" variant="primary" disabled={busy || !jsonText.trim()}>{tc('mcp.form.addJson')}</Button>
        )}
      </div>
    </form>
  )
}
