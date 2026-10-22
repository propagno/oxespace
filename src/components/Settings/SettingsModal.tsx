import {
  ArrowUpCircle,
  Activity,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Mic,
  Package,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  SquareTerminal,
  Palette,
  X,
  Zap
} from 'lucide-react'
import { AppearanceSettings } from './AppearanceSettings'
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { AgentProfile, AgentProvider, AgentReadiness } from '../../../shared/types/agent'
import type { VoiceModelSize, VoiceModelStatus } from '../../../shared/types/voice'
import type { SemanticUsage, SemanticVectorStatus } from '../../../shared/types/ipc'
import type { AgentHookAgent, AgentHooksStatus } from '../../../shared/types/agent-hooks'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { AutomationsSettings } from './AutomationsSettings'
import { useAgentStore } from '../../store/agent.store'
import { useVoiceStore } from '../../store/voice.store'
import { useSettingsStore, VISITED_WORKSPACES_CAP_MAX, VISITED_WORKSPACES_CAP_MIN } from '../../store/settings.store'
import { TERMINAL_PREFS_DEFAULTS, useTerminalPrefsStore, type TerminalCursorStyle, type TerminalPrefs } from '../../store/terminal-prefs.store'
import { useUpdaterStore } from '../../store/updater.store'
import { Button, SegmentedControl, Switch, TextField, Select } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

export interface SettingsModalProps {
  agentProfiles: AgentProfile[]
  agentReadiness: AgentReadiness[]
  isDiscoveringAgents: boolean
  onClose: () => void
  onDiscoverAgents: () => void
  onConfigureAgent: (profile: AgentProfile) => void
  onNewCustomAgent: () => void
  /** Bind a ready agent to the active terminal pane and restart it. */
  onUseProviderInPane?: (profile: AgentProfile) => void | Promise<void>
}

import { PROVIDER_INSTALL_DOCS } from './providerInstallDocs'
import { THREAD_IDLE_SUSPEND_CHOICES } from '../../../shared/threadLimits'
import { compatibilityBadge, type ProviderCompatibility } from '../../../shared/providerCompatibility'
export { PROVIDER_INSTALL_DOCS }

function openInstallDocs(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function formatCheckedAgo(ts: number | null): string | null {
  if (ts == null) return null
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 45) return 'Checked just now'
  if (sec < 3600) return `Checked ${Math.floor(sec / 60)} min ago`
  if (sec < 86400) return `Checked ${Math.floor(sec / 3600)} h ago`
  return `Checked ${Math.floor(sec / 86400)} d ago`
}

export type SettingsSection = 'providers' | 'appearance' | 'terminal' | 'voice' | 'notifications' | 'updates' | 'diagnostics'

export function SettingsContent({ section, ...props }: SettingsModalProps & { section: SettingsSection }): ReactElement {
  switch (section) {
    case 'appearance': return <AppearanceSettingsSection onClose={props.onClose} />
    case 'terminal': return <TerminalSettingsSection onClose={props.onClose} />
    case 'voice': return <VoiceSettingsSection onClose={props.onClose} />
    case 'notifications': return <NotificationsSettingsSection onClose={props.onClose} />
    case 'updates': return <UpdatesSettingsSection onClose={props.onClose} />
    case 'diagnostics': return <DiagnosticsSettingsSection onClose={props.onClose} />
    default: return <ProvidersSettingsSection {...props} />
  }
}
type ProviderStatus = AgentReadiness['status'] | 'checking' | 'custom'

function readinessFor(profile: AgentProfile, readiness: AgentReadiness[]): AgentReadiness | undefined {
  return readiness.find((item) => item.provider === profile.provider)
}

function resolveProviderStatus(
  profile: AgentProfile,
  readiness: AgentReadiness | undefined,
  isDiscovering: boolean
): ProviderStatus {
  if (profile.provider === 'custom') return 'custom'
  if (isDiscovering && (!readiness || readiness.status === 'unknown')) return 'checking'
  return readiness?.status ?? 'unknown'
}

const STATUS_LABEL: Record<ProviderStatus, string> = {
  ready: 'Ready',
  partial: 'Partial',
  missing: 'Not installed',
  unknown: 'Not checked',
  checking: 'Checking…',
  custom: 'Custom'
}

const STATUS_RANK: Record<ProviderStatus, number> = {
  ready: 0,
  partial: 1,
  custom: 2,
  checking: 3,
  unknown: 4,
  missing: 5
}

function ReadinessBadge({ status }: { status: ProviderStatus }): ReactElement {
  const tone = status === 'checking' ? 'unknown' : status === 'custom' ? 'ready' : status
  return <span className={`agent-badge ${tone}`}>{STATUS_LABEL[status]}</span>
}

function SettingsSwitch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (next: boolean) => void; ariaLabel: string }): ReactElement {
  return <Switch checked={checked} onChange={onChange} ariaLabel={ariaLabel} />
}

function DiagnosticsSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const [snapshot, setSnapshot] = useState<import('../../../shared/types/diagnostics').DiagnosticsSnapshot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = (): void => {
    setNotice(null)
    void window.oxe.diagnostics.getSnapshot().then(setSnapshot).catch((error) => setNotice(humanizeError(error)))
  }

  useEffect(refresh, [])

  const exportReport = (): void => {
    setNotice(null)
    void window.oxe.diagnostics.exportReport()
      .then((path) => setNotice(path ? `Saved sanitized report to ${path}` : 'Export cancelled.'))
      .catch((error) => setNotice(humanizeError(error)))
  }

  const failing = snapshot?.checks.filter((check) => check.tone === 'error').length ?? 0
  const warning = snapshot?.checks.filter((check) => check.tone === 'warning').length ?? 0
  const summary = !snapshot
    ? 'Checking…'
    : failing > 0
      ? `${failing} failing${warning > 0 ? ` · ${warning} warning` : ''}`
      : warning > 0
        ? `${warning} warning`
        : `All ${snapshot.checks.length} checks passing`

  return (
    <section className="settings-modal-content" aria-labelledby="settings-diagnostics-title">
      {/* Refresh belongs in the header, matching Health check in AI Providers —
          the section's primary verb should be in the same place on every tab. */}
      <SettingsContentHeader
        kicker="Runtime"
        title="Diagnostics"
        titleId="settings-diagnostics-title"
        description="Compact local diagnostics: up to 1.5 MiB for seven days. Export excludes prompts, terminal output and command arguments."
        onClose={onClose}
        actions={
          <Button variant="ghost" onClick={refresh} title="Re-run checks">
            <RefreshCw size={14} aria-hidden="true" />
            <span>Refresh</span>
          </Button>
        }
      />
      <div className="settings-content-body">
        <div className="diagnostics-hero" data-testid="diagnostics-summary">
          <div className="diagnostics-hero-text">
            <strong>{summary}</strong>
            <span>Collected locally · exports redact paths and secrets</span>
          </div>
          <div className="diagnostics-hero-badges">
            {failing > 0 ? <span className="diagnostics-badge tone-error">{failing} failing</span> : null}
            {warning > 0 ? <span className="diagnostics-badge tone-warning">{warning} warning</span> : null}
            {snapshot && failing === 0 && warning === 0 ? <span className="diagnostics-badge tone-ok">healthy</span> : null}
          </div>
        </div>

        <div className="diagnostics-checks" data-testid="diagnostics-checks">
          {snapshot
            ? snapshot.checks.map((check) => (
              <div key={check.id} className={`diagnostics-check tone-${check.tone}`}>
                <span className="diagnostics-check-dot" aria-hidden="true" />
                <span className="diagnostics-check-label">{check.label}</span>
                <span className="diagnostics-check-detail" title={check.detail}>{check.detail}</span>
              </div>
            ))
            : [0, 1, 2, 3].map((i) => <div key={i} className="diagnostics-check is-loading" aria-hidden="true" />)}
        </div>

        {snapshot ? (
          <dl className="diagnostics-env" data-testid="diagnostics-env">
            <div><dt>OXESpace</dt><dd>{snapshot.appVersion}</dd></div>
            <div><dt>Electron</dt><dd>{snapshot.electronVersion}</dd></div>
            <div><dt>Node</dt><dd>{snapshot.nodeVersion}</dd></div>
            <div><dt>Platform</dt><dd>{snapshot.platform} {snapshot.arch}</dd></div>
            <div><dt>Workspaces</dt><dd>{snapshot.workspaceCount}</dd></div>
          </dl>
        ) : null}

        {notice ? <div className="settings-callout" role="status">{notice}</div> : null}

        <div className="settings-inline-actions">
          <Button variant="primary" onClick={exportReport}>
            <Download size={14} aria-hidden="true" /> Export report
          </Button>
        </div>
      </div>
    </section>
  )
}

function SettingsContentHeader({
  kicker,
  title,
  titleId,
  description,
  onClose,
  actions
}: {
  kicker: string
  title: string
  titleId: string
  description?: string
  onClose: () => void
  actions?: ReactNode
}): ReactElement {
  return (
    <header className="settings-content-header">
      <div>
        <span className="settings-content-kicker">{kicker}</span>
        <h2 id={titleId}>{title}</h2>
        {description && <p className="settings-content-description">{description}</p>}
      </div>
      <div className="settings-content-actions">
        {actions}
        <Button variant="ghost" size="sm" square aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </Button>
      </div>
    </header>
  )
}

function ProvidersSettingsSection({
  agentProfiles,
  agentReadiness,
  isDiscoveringAgents,
  onClose,
  onDiscoverAgents,
  onConfigureAgent,
  onNewCustomAgent,
  onUseProviderInPane
}: {
  agentProfiles: AgentProfile[]
  agentReadiness: AgentReadiness[]
  isDiscoveringAgents: boolean
  onClose: () => void
  onDiscoverAgents: () => void
  onConfigureAgent: (profile: AgentProfile) => void
  onNewCustomAgent: () => void
  onUseProviderInPane?: (profile: AgentProfile) => void | Promise<void>
}): ReactElement {
  const [showMissing, setShowMissing] = useState(false)
  const [usingId, setUsingId] = useState<string | null>(null)
  // The last nightly contract check; one network read when the section opens, cached by the main process.
  const [compatibility, setCompatibility] = useState<ProviderCompatibility | null>(null)
  useEffect(() => {
    let active = true
    void window.oxe?.agent?.compatibility?.().then(value => { if (active) setCompatibility(value) }).catch(() => {})
    return () => { active = false }
  }, [])
  const lastHealthCheckAt = useAgentStore((s) => s.lastHealthCheckAt)
  const checkedLabel = formatCheckedAgo(lastHealthCheckAt)

  // NO auto health check on open. This section is the first tab of Agent
  // Settings, and probing every provider spawns one `<cli> --version` process
  // each — on a cold PATH that stalls the panel for seconds before the user
  // can reach any other tab. Detection is now explicitly user-driven via the
  // Health check button; until then the summary reads "Not checked yet".

  const enriched = useMemo(() => {
    return agentProfiles
      .map((profile) => {
        const readiness = readinessFor(profile, agentReadiness)
        const status = resolveProviderStatus(profile, readiness, isDiscoveringAgents)
        return { profile, readiness, status }
      })
      .sort((a, b) => {
        const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
        if (rank !== 0) return rank
        return a.profile.name.localeCompare(b.profile.name)
      })
  }, [agentProfiles, agentReadiness, isDiscoveringAgents])

  const builtins = enriched.filter((e) => e.profile.provider !== 'custom')
  const readyCount = builtins.filter((e) => e.status === 'ready').length
  const missingCount = builtins.filter((e) => e.status === 'missing').length
  const uncheckedCount = builtins.filter((e) => e.status === 'unknown' || e.status === 'checking').length
  const customCount = enriched.filter((e) => e.status === 'custom').length
  const primary = enriched.filter((e) => e.status !== 'missing')
  const missing = enriched.filter((e) => e.status === 'missing')
  const allMissing = readyCount === 0 && missingCount > 0 && !isDiscoveringAgents

  const summaryPrimary = (() => {
    if (agentProfiles.length === 0) return 'No providers yet'
    if (isDiscoveringAgents && readyCount === 0 && missingCount === 0) return 'Detecting installed CLIs…'
    if (uncheckedCount === builtins.length && !isDiscoveringAgents) return 'Not checked yet'
    if (readyCount === 0 && missingCount > 0) return 'No CLIs detected on PATH'
    return `${readyCount} ready${missingCount > 0 ? ` · ${missingCount} not installed` : ''}`
  })()

  // Only speaks when there is something to act on. With providers already
  // detected the counts above say everything; a line explaining what a CLI is
  // for is noise the user reads once and then scrolls past forever.
  const summarySecondary = (() => {
    if (isDiscoveringAgents) return ''
    if (uncheckedCount === builtins.length) return 'Run Health check to detect installed CLIs'
    if (readyCount === 0 && missingCount > 0) return 'Install a CLI, then run Health check'
    return ''
  })()

  const handleUseInPane = async (profile: AgentProfile): Promise<void> => {
    if (!onUseProviderInPane) return
    setUsingId(profile.agentProfileId)
    try {
      await onUseProviderInPane(profile)
    } finally {
      setUsingId(null)
    }
  }

  const renderCard = ({
    profile,
    readiness,
    status
  }: {
    profile: AgentProfile
    readiness: AgentReadiness | undefined
    status: ProviderStatus
  }): ReactElement => {
    const isCustom = profile.provider === 'custom'
    const install = !isCustom ? PROVIDER_INSTALL_DOCS[profile.provider] : undefined
    const contract = status === 'ready' ? compatibilityBadge(profile.provider, readiness?.version, compatibility) : null
    const detail = isCustom
      ? `skill · parent ${profile.parentProvider ?? '—'}`
      : readiness?.details && status === 'missing'
        ? readiness.details
        : readiness?.version && status === 'ready'
          ? readiness.version
          : profile.command

    return (
      <article
        className={`settings-provider-card status-${status}`}
        key={profile.agentProfileId}
        data-testid={`provider-card-${profile.provider}`}
        data-status={status}
      >
        <div className="settings-provider-card-top">
          <AgentProviderIcon provider={profile.provider} />
          <div className="settings-provider-card-main">
            <strong>{profile.name}</strong>
            <span title={detail}>{detail}</span>
            {contract ? <span className="settings-provider-contract" data-state={contract.state} title={contract.title} data-testid={`provider-contract-${profile.provider}`}>{contract.label}</span> : null}
          </div>
          <div className="settings-provider-card-status">
            <ReadinessBadge status={status} />
          </div>
        </div>
        <div className="settings-provider-card-actions">
          {status === 'ready' ? (
            <span className="settings-provider-hint ok">
              <Check size={12} aria-hidden="true" />
              Available
            </span>
          ) : status === 'missing' ? (
            <span className="settings-provider-hint muted">Not on PATH — install or Fix path</span>
          ) : status === 'checking' ? (
            <span className="settings-provider-hint muted">Probing…</span>
          ) : status === 'custom' ? (
            <span className="settings-provider-hint muted">Uses parent CLI + skill prompt</span>
          ) : (
            <span className="settings-provider-hint muted">Run health check to detect</span>
          )}
          <div className="settings-provider-card-btns">
            {/* Also offered for 'unknown': without an automatic probe on open, a
                never-checked provider would otherwise have no primary action at
                all. If the CLI turns out to be absent, starting the pane says so
                with the exact command it tried — the same information, at the
                moment it actually matters. */}
            {(status === 'ready' || status === 'unknown') && onUseProviderInPane ? (
              <Button
               
                variant="primary"
                aria-label={`Use ${profile.name} in active pane`}
                title="Bind to the active terminal"
                disabled={usingId === profile.agentProfileId}
                onClick={() => void handleUseInPane(profile)}
                data-testid={`btn-use-agent-${profile.provider}`}
              >
                <Play size={14} aria-hidden="true" />
                {usingId === profile.agentProfileId ? 'Starting…' : 'Use in pane'}
              </Button>
            ) : null}
            {status === 'missing' && install ? (
              <Button
               
                variant="ghost"
                aria-label={install.label}
                title={install.url}
                onClick={() => openInstallDocs(install.url)}
                data-testid={`btn-install-docs-${profile.provider}`}
              >
                <ExternalLink size={14} aria-hidden="true" />
                Install guide
              </Button>
            ) : null}
            <Button
             
              variant="ghost"
              aria-label={`Configure ${profile.name}`}
              title="Configure command path or skill"
              onClick={() => onConfigureAgent(profile)}
              data-testid={`btn-configure-agent-${profile.provider}`}
            >
              <Settings2 size={14} aria-hidden="true" />
              {status === 'missing' ? 'Fix path' : 'Configure'}
            </Button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <section className="settings-modal-content" aria-labelledby="settings-providers-title">
      <SettingsContentHeader
        kicker="CLIs & discovery"
        title="Agents"
        titleId="settings-providers-title"
        description="Manage your agents, CLI installations and custom profiles."
        onClose={onClose}
        actions={
          <button
            type="button"
            className="settings-header-action"
            aria-label="Run health check"
            title="Detect which agent CLIs are installed"
            data-testid="btn-discover-agents"
            disabled={isDiscoveringAgents}
            onClick={onDiscoverAgents}
          >
            <RefreshCw size={14} aria-hidden="true" className={isDiscoveringAgents ? 'spin' : undefined} />
            <span>{isDiscoveringAgents ? 'Checking…' : 'Health check'}</span>
          </button>
        }
      />

      <div className="settings-content-body">
        <div className="settings-providers-hero" data-testid="providers-summary">
          <div className="settings-providers-hero-text">
            <strong>{summaryPrimary}</strong>
            {summarySecondary ? <span>{summarySecondary}</span> : null}
            {checkedLabel ? (
              <span className="settings-providers-checked" data-testid="providers-last-checked">
                {checkedLabel}
              </span>
            ) : null}
          </div>
          <div className="settings-providers-stats" aria-label="Provider counts">
            <span className={`settings-stat${readyCount > 0 ? ' ready' : ''}`}>
              <em>{readyCount}</em> ready
            </span>
            {missingCount > 0 ? (
              <span className="settings-stat missing">
                <em>{missingCount}</em> missing
              </span>
            ) : null}
            {customCount > 0 ? (
              <span className="settings-stat custom">
                <em>{customCount}</em> custom
              </span>
            ) : null}
          </div>
        </div>

        {allMissing ? (
          <div className="settings-onboarding" data-testid="providers-onboarding" role="status">
            <Bot size={20} aria-hidden="true" />
            <div>
              <p>Get an agent CLI on this machine</p>
              <span>
                OXESpace launches agents as local CLIs. Install one of the guides below, ensure the command is on PATH,
                then run <strong>Health check</strong>.
              </span>
            </div>
            <div className="settings-onboarding-links">
              {(Object.entries(PROVIDER_INSTALL_DOCS) as Array<[AgentProvider, { label: string; url: string }]>).map(
                ([id, doc]) => (
                  <Button
                    key={id}
                   
                    variant="ghost"
                    onClick={() => openInstallDocs(doc.url)}
                    data-testid={`btn-onboarding-install-${id}`}
                  >
                    <ExternalLink size={12} aria-hidden="true" />
                    {doc.label}
                  </Button>
                )
              )}
            </div>
            <Button
             
              variant="primary"
              disabled={isDiscoveringAgents}
              onClick={onDiscoverAgents}
              data-testid="btn-onboarding-health-check"
            >
              <RefreshCw size={14} aria-hidden="true" className={isDiscoveringAgents ? 'spin' : undefined} />
              {isDiscoveringAgents ? 'Checking…' : 'Detect CLIs'}
            </Button>
          </div>
        ) : null}

        {agentProfiles.length === 0 ? (
          <div className="settings-empty" role="status">
            <Bot size={20} aria-hidden="true" />
            <p>No providers found</p>
            <span>Run a health check to discover installed agent CLIs.</span>
            <Button
             
              variant="primary"
              disabled={isDiscoveringAgents}
              onClick={onDiscoverAgents}
            >
              <RefreshCw size={14} aria-hidden="true" className={isDiscoveringAgents ? 'spin' : undefined} />
              Run health check
            </Button>
          </div>
        ) : (
          <>
            {primary.length > 0 ? (
              <div className="settings-provider-grid" data-testid="providers-primary-list">
                {primary.map(renderCard)}
              </div>
            ) : null}

            {missing.length > 0 ? (
              <div className="settings-provider-missing-block">
                <button
                  type="button"
                  className="settings-provider-missing-toggle"
                  aria-expanded={showMissing || allMissing}
                  data-testid="btn-toggle-missing-providers"
                  onClick={() => setShowMissing((v) => !v)}
                >
                  {(showMissing || allMissing) ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  <span>
                    {missing.length} not installed
                  </span>
                  <em>install guides · fix paths</em>
                </button>
                {(showMissing || allMissing) ? (
                  <div className="settings-provider-grid dimmed" data-testid="providers-missing-list">
                    {missing.map(renderCard)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        <Button
         
          variant="primary" className="settings-new-agent-btn"
          onClick={onNewCustomAgent}
          data-testid="btn-new-custom-agent"
        >
          <Plus size={14} aria-hidden="true" />
          New custom agent
        </Button>

        <IdleConversationsSetting />
        <SemanticIndexSetting />
      </div>
    </section>
  )
}

/** How long an idle Thread conversation keeps its agent process (and the MCP servers it started) running. */
function IdleConversationsSetting(): ReactElement | null {
  const api = window.oxe?.thread
  const [minutes, setMinutes] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.resolve(api?.idleSuspendMinutes?.())
      .then((value) => { if (!cancelled && typeof value === 'number') setMinutes(value) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [api])

  if (minutes === null || !api?.setIdleSuspendMinutes) return null

  const change = async (next: number): Promise<void> => {
    setError('')
    try { setMinutes(await api.setIdleSuspendMinutes!(next)) }
    catch (cause) { setError(humanizeError(cause, 'Could not save this setting')) }
  }

  return (
    <div className="settings-form-group">
      <h3 className="settings-form-group-title">Idle conversations</h3>
      <label className="settings-field">
        <span>Close the agent process after</span>
        <Select aria-label="Close idle conversations after" value={minutes} onChange={(event) => void change(Number(event.target.value))}>
          {THREAD_IDLE_SUSPEND_CHOICES.map((value) => (
            <option key={value} value={value}>{value === 0 ? 'Never' : `${value} minutes without activity`}</option>
          ))}
        </Select>
        <span className="settings-field-hint">
          Each open Thread conversation keeps an agent process and its MCP servers running. Closing idle ones frees
          memory; your next message resumes the same session. A conversation with a running turn, a question, queued
          messages, a background task or a permission allowed for the session stays open.
        </span>
      </label>
      {error && <p className="settings-field-hint" role="alert">{error}</p>}
    </div>
  )
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/**
 * The optional vector index for the agents' repository search tools. Exact-term
 * search (FTS5) and structural search (CodeGraph) work without it; turning it on
 * downloads a ~270 MB embedding model into the app's data folder (it survives
 * updates), or imports one from a folder on networks without internet access.
 */
function SemanticIndexSetting(): ReactElement | null {
  const api = window.oxe?.semantic
  const [status, setStatus] = useState<SemanticVectorStatus | null>(null)
  const [usage, setUsage] = useState<SemanticUsage | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!api?.getVectorStatus) return
    let cancelled = false
    const tick = (): void => {
      void api.getVectorStatus().then((next) => { if (!cancelled) setStatus(next) }).catch(() => {})
    }
    tick()
    void api.getUsage?.().then((next) => { if (!cancelled) setUsage(next) }).catch(() => {})
    // Poll quickly only while something is changing (download / model load).
    const interval = setInterval(tick, status?.state === 'downloading' || status?.state === 'loading' ? 1000 : 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [api, status?.state])

  if (!api?.getVectorStatus || !status || !status.available) return null

  const run = async (action: () => Promise<SemanticVectorStatus>): Promise<void> => {
    setError('')
    setBusy(true)
    try { setStatus(await action()) }
    catch (cause) { setError(humanizeError(cause, 'Could not change the semantic index.')) }
    finally { setBusy(false) }
  }

  const progress = status.progress
  const stateText = status.state === 'off'
    ? 'Off. Agents search with exact terms (FTS5) and code structure (CodeGraph).'
    : status.state === 'downloading'
      ? (progress ? `Downloading model… ${formatMegabytes(progress.loaded)} of ${formatMegabytes(progress.total)}` : 'Downloading model…')
      : status.state === 'loading'
        ? 'Loading the model…'
        : status.state === 'not-installed'
          ? 'On, but the model is not installed. Download it or import it from a folder.'
          : status.state === 'error'
            ? `The model could not load: ${status.error ?? 'unknown error'}`
            : 'Ready. Agents also search by meaning; files are embedded in the background.'
  const calls = usage
    ? Object.values(usage.tools).reduce((sum, tool) => ({
      withVector: sum.withVector + tool.withVector.calls,
      withoutVector: sum.withoutVector + tool.withoutVector.calls
    }), { withVector: 0, withoutVector: 0 })
    : null

  return (
    <div className="settings-form-group" data-testid="semantic-index-setting">
      <h3 className="settings-form-group-title">Semantic index (beta)</h3>
      <div className="settings-toggle-row">
        <span>
          <strong>Search by meaning</strong>
          <small data-testid="semantic-index-state">{stateText}</small>
        </span>
        <SettingsSwitch
          checked={status.enabled}
          onChange={(next) => { if (!busy) void run(() => api.setVectorIndex(next)) }}
          ariaLabel="Search by meaning with the semantic index"
        />
      </div>
      {status.state === 'downloading' && progress && progress.total > 0 && (
        <div className="settings-progress" role="progressbar" aria-label="Model download" aria-valuenow={Math.floor((progress.loaded / progress.total) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="settings-progress-bar" style={{ width: `${Math.floor((progress.loaded / progress.total) * 100)}%` }} />
        </div>
      )}
      {status.enabled && (status.state === 'not-installed' || status.state === 'error') && (
        <div className="settings-inline-actions">
          <Button size="sm" disabled={busy} onClick={() => void run(() => api.downloadModel())} data-testid="btn-semantic-download">
            <Download size={14} aria-hidden="true" />
            Download model (~270 MB)
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api.importModel())} data-testid="btn-semantic-import">
            Import from folder…
          </Button>
        </div>
      )}
      {status.installed && !status.enabled && (
        <div className="settings-inline-actions">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api.removeModel())}>
            Remove downloaded model
          </Button>
        </div>
      )}
      <span className="settings-field-hint">
        The model ({status.modelId}) runs on this machine and is kept in the app&apos;s data folder, so updates do not
        download it again. To import, choose a folder with config.json, tokenizer.json, tokenizer_config.json and
        onnx/model_quantized.onnx.
        {calls && (calls.withVector + calls.withoutVector) > 0 && ` Agent searches so far: ${calls.withoutVector} without the index, ${calls.withVector} with it (counted on this machine only).`}
      </span>
      {error && <p className="settings-field-hint" role="alert">{error}</p>}
    </div>
  )
}

const MODEL_OPTIONS: Array<{ value: VoiceModelSize; label: string }> = [
  { value: 'tiny', label: 'Tiny — fastest, least accurate (~75 MB)' },
  { value: 'base', label: 'Base — balanced (~142 MB)' },
  { value: 'small', label: 'Small — more accurate, slower (~466 MB)' }
]

function VoiceSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const { modelSize, pttHotkey, setModelSize, setPttHotkey } = useVoiceStore()
  const [model, setModel] = useState<VoiceModelStatus | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capturingHotkey, setCapturingHotkey] = useState(false)

  useEffect(() => {
    let alive = true
    void window.oxe?.voice?.getModelStatus(modelSize).then((s) => { if (alive) setModel(s) })
    return () => { alive = false }
  }, [modelSize])

  useEffect(() => {
    return window.oxe?.voice?.onModelProgress((event) => {
      if (event.size !== modelSize) return
      setProgress(event.done ? null : event.progress)
      if (event.error) setError(event.error)
    })
  }, [modelSize])

  useEffect(() => {
    if (!capturingHotkey) return
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturingHotkey(false)
        return
      }
      const parts: string[] = []
      if (event.ctrlKey || event.metaKey) parts.push(event.ctrlKey ? 'Ctrl' : 'Meta')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      const key = event.key
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
        const pretty = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key
        parts.push(pretty)
        if (parts.length > 0) {
          setPttHotkey(parts.join('+'))
          setCapturingHotkey(false)
        }
      }
    }
    // `capture: true` is load-bearing, not stylistic: it runs this listener
    // before Radix's document-level Escape handler, and the stopPropagation
    // above keeps that handler from ever seeing the key. Without it, pressing
    // Escape to cancel a hotkey capture would also close the whole dialog.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturingHotkey, setPttHotkey])

  const downloadModel = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const status = await window.oxe.voice.ensureModel(modelSize)
      setModel(status)
    } catch (err) {
      setError(humanizeError(err, 'Failed to download model.'))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const progressPct = progress !== null ? Math.round(progress * 100) : null

  return (
    <section className="settings-modal-content" aria-labelledby="settings-voice-title">
      <SettingsContentHeader
        kicker="OXEVoice · local STT"
        title="Voice"
        titleId="settings-voice-title"
        description="Dictate with local transcription and your preferred shortcuts."
        onClose={onClose}
      />

      <div className="settings-content-body settings-form">
        <label className="settings-field">
          <span>Language</span>
          <TextField type="text" value="Portuguese (Brazil)" readOnly disabled aria-label="Fixed language: Brazilian Portuguese" />
        </label>

        <label className="settings-field">
          <span>Model</span>
          <Select value={modelSize} onChange={(e) => setModelSize(e.target.value as VoiceModelSize)}>
            {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>

        <div className="settings-field">
          <span>Push-to-talk shortcut</span>
          <div className="settings-hotkey-row">
            <TextField
              type="text"
              value={pttHotkey}
              spellCheck={false}
              onChange={(e) => setPttHotkey(e.target.value)}
              placeholder="Ctrl+Shift+Space"
              aria-label="Push-to-talk shortcut"
            />
            <button
              type="button"
              className={`settings-btn ghost${capturingHotkey ? ' active' : ''}`}
              onClick={() => setCapturingHotkey((v) => !v)}
            >
              {capturingHotkey ? 'Press keys…' : 'Capture'}
            </button>
          </div>
          {capturingHotkey ? (
            <span className="settings-field-hint">Press the shortcut, or Esc to cancel</span>
          ) : null}
        </div>

        <div className="settings-status-card">
          <div className="settings-status-row">
            <strong>Engine</strong>
            <span className={`settings-status-pill ${model?.engineReady ? 'ok' : 'warn'}`}>
              {model?.engineReady ? 'available' : 'unavailable'}
            </span>
          </div>
          <div className="settings-status-row">
            <strong>Model «{modelSize}»</strong>
            <span className={`settings-status-pill ${model?.ready ? 'ok' : 'warn'}`}>
              {model?.ready ? 'ready' : progressPct !== null ? `downloading… ${progressPct}%` : 'not downloaded'}
            </span>
          </div>
          {progressPct !== null ? (
            <div className="settings-progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
              <div className="settings-progress-bar" style={{ width: `${progressPct}%` }} />
            </div>
          ) : null}
          {model && !model.engineReady ? (
            <p className="settings-field-hint" role="note">
              Voice input needs the whisper.cpp engine, which this version ships for Windows only. The model download starts once the engine is available on this system.
            </p>
          ) : !model?.ready ? (
            <Button
             
              variant="primary"
              disabled={busy || !model?.engineReady}
              onClick={() => void downloadModel()}
            >
              <Download size={14} aria-hidden="true" />
              {busy ? 'Downloading…' : 'Download model'}
            </Button>
          ) : (
            <div className="settings-status-ok-line">
              <Check size={14} aria-hidden="true" />
              Model ready for push-to-talk
            </div>
          )}
          {error ? <p className="settings-error">{error}</p> : null}
        </div>

        <div className="settings-callout">
          Local recognition (whisper.cpp), <strong>Brazilian Portuguese</strong>.
          Hold the shortcut to speak; tap the mic for hands-free.
        </div>
      </div>
    </section>
  )
}

const CURSOR_OPTIONS: Array<{ value: TerminalCursorStyle; label: string }> = [
  { value: 'block', label: 'Block' },
  { value: 'bar', label: 'Bar' },
  { value: 'underline', label: 'Underline' }
]

const FONT_PRESETS = [
  TERMINAL_PREFS_DEFAULTS.fontFamily,
  'Cascadia Mono, Consolas, monospace',
  'Cascadia Code, monospace',
  'JetBrains Mono, monospace',
  'Fira Code, monospace',
  'Consolas, monospace',
  // Ship with most Linux desktops, where the Windows families above resolve
  // to nothing.
  'DejaVu Sans Mono, monospace',
  'Ubuntu Mono, monospace',
  'Liberation Mono, monospace',
  'monospace'
]

function TerminalPreview({ prefs }: { prefs: TerminalPrefs }): ReactElement {
  const sampleSize = prefs.fontSize
  return (
    <div className="settings-term-preview" aria-hidden="true">
      <div className="settings-term-preview-chrome">
        <span /><span /><span />
        <em>terminal preview</em>
      </div>
      <div
        className="settings-term-preview-body"
        style={{
          fontFamily: prefs.fontFamily,
          fontSize: sampleSize,
          lineHeight: prefs.lineHeight,
          letterSpacing: prefs.letterSpacing,
          opacity: Math.max(0.75, prefs.backgroundOpacity)
        }}
      >
        <div><span className="accent">~/project</span> <span className="muted">main</span></div>
        <div><span className="accent">❯</span> npm run dev</div>
        <div className="muted">
          ready in 312 ms
          <span
            className={`settings-term-cursor cursor-${prefs.cursorStyle}${prefs.cursorBlink ? ' blink' : ''}`}
          />
        </div>
      </div>
      <div className="settings-term-preview-meta">
        {prefs.fontFamily.split(',')[0]} · {prefs.fontSize}px · {prefs.cursorStyle}
        {prefs.backgroundOpacity < 1 ? ` · ${Math.round(prefs.backgroundOpacity * 100)}%` : ''}
      </div>
    </div>
  )
}

function AppearanceSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <section className="settings-modal-content" aria-labelledby="settings-appearance-title">
      <SettingsContentHeader kicker="Global appearance" title="Appearance" titleId="settings-appearance-title" description="Choose light or dark mode for the whole app, or follow your operating system." onClose={onClose} />
      <div className="settings-content-body settings-form"><AppearanceSettings /></div>
    </section>
  )
}

function TerminalSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const global = useTerminalPrefsStore((s) => s.global)
  const setGlobal = useTerminalPrefsStore((s) => s.setGlobal)

  return (
    <section className="settings-modal-content" aria-labelledby="settings-terminal-title">
      <SettingsContentHeader
        kicker="Global appearance"
        title="Terminal"
        titleId="settings-terminal-title"
        description="Set the default font, cursor and behavior for every workspace. Workspace overrides remain independent."
        onClose={onClose}
      />

      <div className="settings-content-body settings-form">
        <TerminalPreview prefs={global} />

        <div className="settings-form-group">
          <h3 className="settings-form-group-title">Font</h3>
          <label className="settings-field">
            <span>Family</span>
            <Select value={global.fontFamily} onChange={(e) => setGlobal({ fontFamily: e.target.value })}>
              {FONT_PRESETS.map((f) => <option key={f} value={f}>{f.split(',')[0]}</option>)}
              {FONT_PRESETS.includes(global.fontFamily) ? null : (
                <option value={global.fontFamily}>{global.fontFamily.split(',')[0]}</option>
              )}
            </Select>
          </label>

          <label className="settings-field">
            <span className="settings-field-label-row">
              Size
              <em>{global.fontSize}px</em>
            </span>
            <input
              type="range"
              min={8}
              max={32}
              step={1}
              value={global.fontSize}
              onChange={(e) => setGlobal({ fontSize: Number(e.target.value) })}
            />
            <span className="settings-field-hint">Ctrl + / Ctrl − / Ctrl 0 in a terminal</span>
          </label>
          {global.fontSize !== TERMINAL_PREFS_DEFAULTS.fontSize && <button type="button" className="settings-reset-font" onClick={() => setGlobal({ fontSize: TERMINAL_PREFS_DEFAULTS.fontSize })}>Reset to {TERMINAL_PREFS_DEFAULTS.fontSize}px</button>}

          <label className="settings-field">
            <span className="settings-field-label-row">
              Line height
              <em>{global.lineHeight.toFixed(1)}</em>
            </span>
            <input
              type="range"
              min={1}
              max={2}
              step={0.1}
              value={global.lineHeight}
              onChange={(e) => setGlobal({ lineHeight: Number(e.target.value) })}
            />
          </label>

          <label className="settings-field">
            <span className="settings-field-label-row">
              Letter spacing
              <em>{global.letterSpacing}px</em>
            </span>
            <input
              type="range"
              min={0}
              max={4}
              step={0.5}
              value={global.letterSpacing}
              onChange={(e) => setGlobal({ letterSpacing: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="settings-form-group">
          <h3 className="settings-form-group-title">Cursor & buffer</h3>
          <label className="settings-field">
            <span>Cursor style</span>
            <Select
              value={global.cursorStyle}
              onChange={(e) => setGlobal({ cursorStyle: e.target.value as TerminalCursorStyle })}
            >
              {CURSOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>

          <div className="settings-toggle-row">
            <span>
              <strong>Blinking cursor</strong>
              <small>Animate the caret in focused terminals</small>
            </span>
            <SettingsSwitch
              checked={global.cursorBlink}
              onChange={(next) => setGlobal({ cursorBlink: next })}
              ariaLabel="Blinking cursor"
            />
          </div>

          <label className="settings-field">
            <span className="settings-field-label-row">
              Scrollback
              <em>{global.scrollback.toLocaleString('en-US')} lines</em>
            </span>
            <input
              type="range"
              min={1000}
              max={200000}
              step={1000}
              value={global.scrollback}
              onChange={(e) => setGlobal({ scrollback: Number(e.target.value) })}
            />
          </label>

          <label className="settings-field">
            <span className="settings-field-label-row">
              Background opacity
              <em>
                {Math.round(global.backgroundOpacity * 100)}%
                {global.backgroundOpacity < 1 ? ' translucent' : ''}
              </em>
            </span>
            <input
              type="range"
              min={0.6}
              max={1}
              step={0.05}
              value={global.backgroundOpacity}
              onChange={(e) => setGlobal({ backgroundOpacity: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="settings-callout">
          <strong>Global</strong> defaults. Workspaces can override them.
        </div>
      </div>
    </section>
  )
}

const AGENT_HOOK_LABEL: Record<AgentHookAgent, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

/**
 * Installs each agent's status hook in the agent's own config. Explicit and
 * per-agent because those files are user-global; the heuristic keeps working
 * whether or not a hook is installed.
 */
function AgentHooksSetting(): ReactElement | null {
  const [statuses, setStatuses] = useState<AgentHooksStatus[] | null>(null)
  const [busy, setBusy] = useState<AgentHookAgent | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.resolve(window.oxe?.agentHooks?.status?.())
      .then((next) => { if (!cancelled) setStatuses(Array.isArray(next) ? next : null) })
      .catch(() => { if (!cancelled) setStatuses(null) })
    return () => { cancelled = true }
  }, [])

  if (!statuses) return null

  const toggle = async (status: AgentHooksStatus): Promise<void> => {
    setBusy(status.agent)
    try {
      const api = window.oxe.agentHooks
      const next = status.state === 'installed' ? await api.remove(status.agent) : await api.install(status.agent)
      setStatuses((current) => (current ?? []).map((s) => (s.agent === next.agent ? next : s)))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-form-group">
      <h3 className="settings-form-group-title">Agent status hooks</h3>
      <div className="settings-callout">
        Let Claude Code and Codex report <strong>working / waiting / done</strong> themselves instead of
        guessing from terminal output. Writes to the agent&apos;s own config; your existing hooks are kept.
      </div>
      {statuses.map((status) => (
        <div className="settings-toggle-row" key={status.agent}>
          <span>
            <strong>{AGENT_HOOK_LABEL[status.agent]}</strong>
            <small>
              {status.state === 'installed' && 'Installed.'}
              {status.state === 'partial' && `Partially installed (missing: ${status.missing.join(', ')}).`}
              {status.state === 'not_installed' && 'Not installed — using output heuristics.'}
              {status.state === 'error' && `Cannot update: ${status.detail ?? 'unknown error'}`}
            </small>
          </span>
          <SettingsSwitch
            checked={status.state === 'installed' || status.state === 'partial'}
            onChange={() => { if (busy === null) void toggle(status) }}
            ariaLabel={`Report ${AGENT_HOOK_LABEL[status.agent]} status through hooks`}
          />
        </div>
      ))}
    </div>
  )
}

function NotificationsSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled)
  const visitedWorkspacesCap = useSettingsStore((s) => s.visitedWorkspacesCap)
  const setVisitedWorkspacesCap = useSettingsStore((s) => s.setVisitedWorkspacesCap)

  const sendTest = (): void => {
    void window.oxe?.notifications?.notify({
      title: 'OXESpace',
      body: 'Test notification',
      paneId: 'test',
      workspaceId: 'test'
    }).catch(() => undefined)
  }

  return (
    <section className="settings-modal-content" aria-labelledby="settings-notifications-title">
      <SettingsContentHeader
        kicker="System"
        title="Notifications"
        titleId="settings-notifications-title"
        description="Choose when OXESpace gets your attention."
        onClose={onClose}
      />

      <div className="settings-content-body settings-form">
        <div className="settings-toggle-row featured">
          <span>
            <strong>Notify when an agent needs you</strong>
            <small>
              Desktop alerts when a background agent finishes, exits, or errors.
              Clicking focuses the terminal.
            </small>
          </span>
          <SettingsSwitch
            checked={notificationsEnabled}
            onChange={setNotificationsEnabled}
            ariaLabel="Notify when an agent needs you"
          />
        </div>

        <div className="settings-callout">
          Only for terminals you are <strong>not watching</strong>.
        </div>

        <Button
         
          variant="ghost"
          onClick={sendTest}
          disabled={!notificationsEnabled}
          data-testid="btn-test-notification"
        >
          <Bell size={14} aria-hidden="true" />
          Send test notification
        </Button>

        <AgentHooksSetting />

        <AutomationsSettings />

        <div className="settings-form-group">
          <h3 className="settings-form-group-title">Performance</h3>
          <label className="settings-field">
            <span className="settings-field-label-row">
              Keep recent workspaces mounted
              <em data-testid="visited-workspaces-cap-value">{visitedWorkspacesCap}</em>
            </span>
            <input
              type="range"
              min={VISITED_WORKSPACES_CAP_MIN}
              max={VISITED_WORKSPACES_CAP_MAX}
              step={1}
              value={visitedWorkspacesCap}
              onChange={(e) => setVisitedWorkspacesCap(Number(e.target.value))}
              data-testid="visited-workspaces-cap"
              aria-label="Number of workspaces to keep mounted"
            />
            <span className="settings-field-hint">Background terminals keep running either way.</span>
          </label>
        </div>
      </div>
    </section>
  )
}

function UpdatesSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const app = useUpdaterStore((s) => s.app)
  const rtk = useUpdaterStore((s) => s.rtk)
  const bootstrap = useUpdaterStore((s) => s.bootstrap)
  const checkAppUpdates = useUpdaterStore((s) => s.checkAppUpdates)
  const quitAndInstall = useUpdaterStore((s) => s.quitAndInstall)
  const downloadAppUpdate = useUpdaterStore((s) => s.downloadAppUpdate)
  const setUpdatePreferences = useUpdaterStore((s) => s.setUpdatePreferences)
  const checkRtk = useUpdaterStore((s) => s.checkRtk)
  const updateRtk = useUpdaterStore((s) => s.updateRtk)

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  const manualInstall = app.installMode === 'manual' || app.status === 'disabled'
  const preferences = app.preferences ?? { mode: 'auto' as const, pinnedVersion: null }
  const pinned = preferences.pinnedVersion !== null
  // Only Automatic, without a pinned version, downloads on its own; otherwise a found update waits for the person.
  const asksToDownload = !manualInstall && (preferences.mode !== 'auto' || pinned)
  const modeHint = pinned ? `Staying on v${preferences.pinnedVersion}: OXESpace does not check or download updates. Check for updates still tells you what is new.`
    : preferences.mode === 'auto' ? 'Checks every few hours, downloads in the background and installs when you restart.'
      : preferences.mode === 'notify' ? 'Checks every few hours and tells you when a version is out. Nothing downloads until you choose.'
        : 'Never checks on its own. Use Check for updates when you want to know.'
  const isDevBuild = app.status === 'disabled'
  const versionLabel = app.currentVersion === 'dev' || !app.currentVersion
    ? 'dev build'
    : `v${app.currentVersion}`

  const appStatusLabel = (() => {
    switch (app.status) {
      case 'disabled':
        return 'Update service unavailable'
      case 'checking':
        return 'Checking GitHub Releases…'
      case 'available':
        return manualInstall ? `Update ${app.availableVersion} available — install it from Releases` : asksToDownload ? `Update ${app.availableVersion} available` : `Update ${app.availableVersion} available — downloading in the background`
      case 'downloading':
        return `Downloading ${app.availableVersion ?? 'update'}… ${app.progress ?? 0}%`
      case 'downloaded':
        return `Ready to install ${app.availableVersion}`
      case 'not-available':
        return 'No newer published release found'
      case 'error':
        return 'Update check failed'
      default:
        return 'Waiting for update status…'
    }
  })()

  const appPillClass = isDevBuild
    ? 'muted'
    : app.status === 'downloaded' || app.status === 'available' || app.status === 'downloading'
      ? 'warn'
      : app.status === 'not-available'
        ? 'ok'
        : app.status === 'error'
          ? 'err'
          : 'muted'

  const appPillLabel = isDevBuild
    ? 'Dev build'
    : app.status === 'not-available'
      ? 'Up to date'
      : app.status === 'available'
        ? 'Update'
        : app.status === 'downloaded'
          ? 'Ready'
          : app.status === 'downloading'
            ? 'Downloading'
            : app.status === 'checking'
              ? 'Checking'
              : app.status === 'error'
                ? 'Error'
                : 'Idle'

  return (
    <section className="settings-modal-content" aria-labelledby="settings-updates-title">
      <SettingsContentHeader
        kicker="System"
        title="Updates"
        titleId="settings-updates-title"
        description="Keep OXESpace and its tools up to date."
        onClose={onClose}
      />

      <div className="settings-content-body settings-form settings-updates-form">
        <h3 className="settings-update-group-label">Application & tools</h3>
        <div className="settings-update-group">
          <article
            className={`settings-update-card${isDevBuild ? ' is-dev' : ''}`}
            data-testid="settings-app-update"
            data-status={app.status}
          >
            <div className="settings-update-card-head">
              <span className="settings-update-icon app" aria-hidden="true">
                <ArrowUpCircle size={16} />
              </span>
              <div>
                <strong>OXESpace</strong>
                <span>{versionLabel}</span>
              </div>
              <span className={`settings-status-pill ${appPillClass}`} data-testid="app-update-pill">
                {appPillLabel}
              </span>
            </div>
            <p className="settings-update-status">{appStatusLabel}</p>
            {app.status === 'downloading' && app.progress != null ? (
              <div className="settings-progress" role="progressbar" aria-label="Downloading OXESpace update" aria-valuenow={app.progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="settings-progress-bar" style={{ width: `${app.progress}%` }} />
              </div>
            ) : null}
            {app.error && app.status === 'error' ? (
              <p className="settings-error" data-testid="app-update-error">{app.error}</p>
            ) : null}
            {app.preferences ? (
              <div className="settings-update-preferences">
                <SegmentedControl label="How OXESpace updates" value={preferences.mode}
                  options={[{ value: 'auto', label: 'Automatic' }, { value: 'notify', label: 'Notify me' }, { value: 'off', label: 'Off' }]}
                  onChange={(mode) => void setUpdatePreferences({ ...preferences, mode })} />
                <Switch checked={pinned} label={`Stay on v${pinned ? preferences.pinnedVersion : app.currentVersion}`} description="Keep this version until you turn this off."
                  onChange={(checked) => void setUpdatePreferences({ ...preferences, pinnedVersion: checked ? app.currentVersion : null })} />
                <p className="settings-update-mode-hint" data-testid="app-update-mode-hint">{modeHint}</p>
              </div>
            ) : null}
            <div className="settings-update-actions">
              {asksToDownload && app.status === 'available' ? (
                <Button variant="primary" onClick={() => void downloadAppUpdate()} data-testid="btn-download-app-update">
                  <Download size={14} aria-hidden="true" />
                  Download {app.availableVersion}
                </Button>
              ) : null}
              <Button
               
                variant="ghost"
                disabled={app.status === 'checking' || app.status === 'downloading'}
                onClick={() => void checkAppUpdates()}
                data-testid="btn-check-app-updates"
                title="Check GitHub Releases for a new version"
              >
                <RefreshCw size={14} aria-hidden="true" />
                Check for updates
              </Button>
              {app.status === 'downloaded' ? (
                <Button
                 
                  variant="primary"
                  onClick={() => void quitAndInstall()}
                  data-testid="btn-install-app-update"
                >
                  <Download size={14} aria-hidden="true" />
                  Restart & install
                </Button>
              ) : null}
              {manualInstall && app.status === 'available' ? <a className="settings-btn primary" href="https://github.com/propagno/oxespace/releases/latest" target="_blank" rel="noopener noreferrer"><Download size={14} aria-hidden="true" /> Open releases</a> : null}
            </div>
            <p className="settings-update-hint">
              {manualInstall ? 'Development and Linux package installs cannot update in place. Use the latest release or update your development checkout.' : asksToDownload ? 'Downloaded updates install when you restart.' : 'Downloads in the background. Restart to apply.'}
            </p>
          </article>

          <article className="settings-update-card" data-testid="settings-rtk-update">
            <div className="settings-update-card-head">
              <span className="settings-update-icon rtk" aria-hidden="true">
                <Zap size={16} />
              </span>
              <div>
                <strong>RTK</strong>
                <span>{rtk.installed ? (rtk.version ?? 'installed (no version file)') : 'not installed'}</span>
              </div>
              <span className={`settings-status-pill ${rtk.error ? 'err' : rtk.checking || rtk.updating ? 'muted' : rtk.updateAvailable ? 'warn' : rtk.installed ? 'ok' : 'muted'}`}>
                {rtk.error ? 'Error' : rtk.checking ? 'Checking' : rtk.updating ? 'Updating' : rtk.updateAvailable ? 'Update available' : rtk.installed ? 'Up to date' : 'Not installed'}
              </span>
            </div>
            <p className="settings-update-status">
              {rtk.checking
                ? 'Checking GitHub…'
                : rtk.updating
                  ? 'Updating…'
                  : rtk.updateAvailable
                    ? `Update available: ${rtk.latestVersion}`
                    : rtk.latestVersion
                      ? `Latest ${rtk.latestVersion} · up to date`
                      : isDevBuild
                        ? 'Works in dev — check or install the sidecar anytime'
                        : 'Not checked yet'}
            </p>
            {rtk.error ? <p className="settings-error">{rtk.error}</p> : null}
            <div className="settings-update-actions">
              <Button
               
                variant="ghost"
                disabled={rtk.checking || rtk.updating}
                onClick={() => void checkRtk()}
                data-testid="btn-check-rtk"
              >
                <RefreshCw size={14} aria-hidden="true" />
                Check RTK
              </Button>
              <Button
               
                variant="primary"
                disabled={rtk.checking || rtk.updating || (!rtk.updateAvailable && rtk.installed)}
                onClick={() => void updateRtk()}
                data-testid="btn-update-rtk"
              >
                <Download size={14} aria-hidden="true" />
                {rtk.installed ? 'Update RTK' : 'Install RTK'}
              </Button>
            </div>
            <p className="settings-update-hint">Sidecar binary. Updates independently of OXESpace.</p>
          </article>

        </div>
        <h3 className="settings-update-group-label">Included with OXESpace</h3>
        <article className="settings-update-card bundled" data-testid="settings-bundled-tools">
          <div className="settings-update-card-head">
            <span className="settings-update-icon bundled" aria-hidden="true">
              <Package size={16} />
            </span>
            <div>
              <strong>Built-in tools</strong>
              <span>Updated with each application release</span>
            </div>
            <span className="settings-status-pill ok">included</span>
          </div>
          <ul className="settings-bundled-list">
            <li>
              <strong>Caveman</strong>
              <span>In-app prompt / agent workflow</span>
            </li>
            <li>
              <strong>CodeGraph</strong>
              <span>Vendored code intelligence</span>
            </li>
          </ul>
        </article>
      </div>
    </section>
  )
}
