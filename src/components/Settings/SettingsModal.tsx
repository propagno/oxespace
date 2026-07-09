import {
  ArrowUpCircle,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Mic,
  Package,
  Plus,
  RefreshCw,
  Settings2,
  SquareTerminal,
  X,
  Zap
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'
import type { VoiceModelSize, VoiceModelStatus } from '../../../shared/types/voice'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { useVoiceStore } from '../../store/voice.store'
import { useSettingsStore } from '../../store/settings.store'
import { useTerminalPrefsStore, type TerminalCursorStyle, type TerminalPrefs } from '../../store/terminal-prefs.store'
import { useUpdaterStore } from '../../store/updater.store'

interface SettingsModalProps {
  agentProfiles: AgentProfile[]
  agentReadiness: AgentReadiness[]
  isDiscoveringAgents: boolean
  onClose: () => void
  onDiscoverAgents: () => void
  onConfigureAgent: (profile: AgentProfile) => void
  onNewCustomAgent: () => void
}

type SettingsSection = 'providers' | 'terminal' | 'voice' | 'notifications' | 'updates'
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

function SettingsSwitch({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel: string
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`settings-switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch-thumb" aria-hidden="true" />
    </button>
  )
}

const NAV_ITEMS: Array<{ id: SettingsSection; label: string; icon: ReactNode }> = [
  { id: 'providers', label: 'AI Providers', icon: <Bot size={14} aria-hidden="true" /> },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={14} aria-hidden="true" /> },
  { id: 'voice', label: 'Voice', icon: <Mic size={14} aria-hidden="true" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={14} aria-hidden="true" /> },
  { id: 'updates', label: 'Updates', icon: <ArrowUpCircle size={14} aria-hidden="true" /> }
]

export function SettingsModal({
  agentProfiles,
  agentReadiness,
  isDiscoveringAgents,
  onClose,
  onDiscoverAgents,
  onConfigureAgent,
  onNewCustomAgent
}: SettingsModalProps): ReactElement {
  const [section, setSection] = useState<SettingsSection>('providers')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        data-testid="settings-modal"
      >
        <aside className="settings-modal-nav" aria-label="Settings sections">
          <header className="settings-modal-brand">
            <span className="settings-modal-brand-icon" aria-hidden="true">
              <Bot size={16} />
            </span>
            <div>
              <span>OXESpace</span>
              <strong id="settings-title">Agent Settings</strong>
            </div>
          </header>
          <nav>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-item${section === item.id ? ' active' : ''}`}
                aria-current={section === item.id ? 'page' : undefined}
                onClick={() => setSection(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <p className="settings-modal-nav-hint">
            <kbd>Esc</kbd> close
          </p>
        </aside>

        {section === 'terminal' ? (
          <TerminalSettingsSection onClose={onClose} />
        ) : section === 'voice' ? (
          <VoiceSettingsSection onClose={onClose} />
        ) : section === 'notifications' ? (
          <NotificationsSettingsSection onClose={onClose} />
        ) : section === 'updates' ? (
          <UpdatesSettingsSection onClose={onClose} />
        ) : (
          <ProvidersSettingsSection
            agentProfiles={agentProfiles}
            agentReadiness={agentReadiness}
            isDiscoveringAgents={isDiscoveringAgents}
            onClose={onClose}
            onDiscoverAgents={onDiscoverAgents}
            onConfigureAgent={onConfigureAgent}
            onNewCustomAgent={onNewCustomAgent}
          />
        )}
      </section>
    </div>
  )
}

function SettingsContentHeader({
  kicker,
  title,
  titleId,
  onClose,
  actions
}: {
  kicker: string
  title: string
  titleId: string
  onClose: () => void
  actions?: ReactNode
}): ReactElement {
  return (
    <header className="settings-content-header">
      <div>
        <span>{kicker}</span>
        <h2 id={titleId}>{title}</h2>
      </div>
      <div className="settings-content-actions">
        {actions}
        <button type="button" className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
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
  onNewCustomAgent
}: {
  agentProfiles: AgentProfile[]
  agentReadiness: AgentReadiness[]
  isDiscoveringAgents: boolean
  onClose: () => void
  onDiscoverAgents: () => void
  onConfigureAgent: (profile: AgentProfile) => void
  onNewCustomAgent: () => void
}): ReactElement {
  const autoCheckedRef = useRef(false)
  const [showMissing, setShowMissing] = useState(false)

  // Auto-run health check once when the section opens with no useful readiness data.
  useEffect(() => {
    if (autoCheckedRef.current || isDiscoveringAgents || agentProfiles.length === 0) return
    const builtins = agentProfiles.filter((p) => p.provider !== 'custom')
    if (builtins.length === 0) return
    const needsProbe = builtins.every((p) => {
      const r = readinessFor(p, agentReadiness)
      return !r || r.status === 'unknown'
    })
    if (!needsProbe) return
    autoCheckedRef.current = true
    onDiscoverAgents()
  }, [agentProfiles, agentReadiness, isDiscoveringAgents, onDiscoverAgents])

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

  const summaryPrimary = (() => {
    if (agentProfiles.length === 0) return 'No providers yet'
    if (isDiscoveringAgents && readyCount === 0 && missingCount === 0) return 'Detecting installed CLIs…'
    if (uncheckedCount === builtins.length && !isDiscoveringAgents) return 'Not checked yet'
    if (readyCount === 0 && missingCount > 0) return 'No CLIs detected on PATH'
    return `${readyCount} ready${missingCount > 0 ? ` · ${missingCount} not installed` : ''}`
  })()

  const summarySecondary = (() => {
    if (isDiscoveringAgents) return 'Probing each agent command with --version'
    if (readyCount > 0) return 'Ready CLIs can be used in terminal panes'
    if (missingCount > 0) return 'Install a CLI or fix the command path via Configure'
    return 'Detect which agent CLIs are available on this machine'
  })()

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
            <span className="settings-provider-hint muted">Not on PATH — set command if installed elsewhere</span>
          ) : status === 'checking' ? (
            <span className="settings-provider-hint muted">Probing…</span>
          ) : status === 'custom' ? (
            <span className="settings-provider-hint muted">Uses parent CLI + skill prompt</span>
          ) : (
            <span className="settings-provider-hint muted">Run health check to detect</span>
          )}
          <button
            type="button"
            className="settings-btn ghost"
            aria-label={`Configure ${profile.name}`}
            title="Configure command path or skill"
            onClick={() => onConfigureAgent(profile)}
            data-testid={`btn-configure-agent-${profile.provider}`}
          >
            <Settings2 size={13} aria-hidden="true" />
            {status === 'missing' ? 'Fix path' : 'Configure'}
          </button>
        </div>
      </article>
    )
  }

  return (
    <section className="settings-modal-content" aria-labelledby="settings-providers-title">
      <SettingsContentHeader
        kicker="CLIs & discovery"
        title="AI Providers"
        titleId="settings-providers-title"
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
            <RefreshCw size={13} aria-hidden="true" className={isDiscoveringAgents ? 'spin' : undefined} />
            <span>{isDiscoveringAgents ? 'Checking…' : 'Health check'}</span>
          </button>
        }
      />

      <div className="settings-content-body">
        <div className="settings-providers-hero" data-testid="providers-summary">
          <div className="settings-providers-hero-text">
            <strong>{summaryPrimary}</strong>
            <span>{summarySecondary}</span>
          </div>
          <div className="settings-providers-stats" aria-label="Provider counts">
            <span className="settings-stat ready">
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

        {agentProfiles.length === 0 ? (
          <div className="settings-empty" role="status">
            <Bot size={22} aria-hidden="true" />
            <p>No providers found</p>
            <span>Run a health check to discover installed agent CLIs.</span>
            <button
              type="button"
              className="settings-btn primary"
              disabled={isDiscoveringAgents}
              onClick={onDiscoverAgents}
            >
              <RefreshCw size={13} aria-hidden="true" className={isDiscoveringAgents ? 'spin' : undefined} />
              Run health check
            </button>
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
                  aria-expanded={showMissing}
                  data-testid="btn-toggle-missing-providers"
                  onClick={() => setShowMissing((v) => !v)}
                >
                  {showMissing ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  <span>
                    {missing.length} not installed
                  </span>
                  <em>optional — expand to fix paths</em>
                </button>
                {showMissing ? (
                  <div className="settings-provider-grid dimmed" data-testid="providers-missing-list">
                    {missing.map(renderCard)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {primary.length === 0 && missing.length > 0 && !showMissing ? (
              <div className="settings-empty compact" role="status">
                <p>No agent CLIs found on PATH</p>
                <span>Install Claude, Copilot, Codex, etc., or expand “not installed” to set a custom command path.</span>
              </div>
            ) : null}
          </>
        )}

        <button
          type="button"
          className="settings-btn primary settings-new-agent-btn"
          onClick={onNewCustomAgent}
          data-testid="btn-new-custom-agent"
        >
          <Plus size={14} aria-hidden="true" />
          New custom agent
        </button>
      </div>
    </section>
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
      setError(err instanceof Error ? err.message : 'Failed to download model.')
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
        onClose={onClose}
      />

      <div className="settings-content-body settings-form">
        <label className="settings-field">
          <span>Language</span>
          <input type="text" value="Portuguese (Brazil)" readOnly disabled aria-label="Fixed language: Brazilian Portuguese" />
        </label>

        <label className="settings-field">
          <span>Model</span>
          <select value={modelSize} onChange={(e) => setModelSize(e.target.value as VoiceModelSize)}>
            {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <div className="settings-field">
          <span>Push-to-talk shortcut</span>
          <div className="settings-hotkey-row">
            <input
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
          {!model?.ready ? (
            <button
              type="button"
              className="settings-btn primary"
              disabled={busy || !model?.engineReady}
              onClick={() => void downloadModel()}
            >
              <Download size={13} aria-hidden="true" />
              {busy ? 'Downloading…' : 'Download model'}
            </button>
          ) : (
            <div className="settings-status-ok-line">
              <Check size={13} aria-hidden="true" />
              Model ready for push-to-talk
            </div>
          )}
          {error ? <p className="settings-error">{error}</p> : null}
        </div>

        <div className="settings-callout">
          Recognition runs 100% local (whisper.cpp) in <strong>Brazilian Portuguese</strong> — audio never leaves your machine.
          Hold the shortcut to speak and release to insert into the terminal; a mic tap toggles hands-free mode.
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
  'JetBrains Mono, Cascadia Mono, Consolas, monospace',
  'Cascadia Mono, Consolas, monospace',
  'Cascadia Code, monospace',
  'JetBrains Mono, monospace',
  'Fira Code, monospace',
  'Consolas, monospace',
  'monospace'
]

function TerminalPreview({ prefs }: { prefs: TerminalPrefs }): ReactElement {
  const sampleSize = Math.max(10, Math.min(prefs.fontSize, 15))
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

function TerminalSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const global = useTerminalPrefsStore((s) => s.global)
  const setGlobal = useTerminalPrefsStore((s) => s.setGlobal)

  return (
    <section className="settings-modal-content" aria-labelledby="settings-terminal-title">
      <SettingsContentHeader
        kicker="Global appearance"
        title="Terminal"
        titleId="settings-terminal-title"
        onClose={onClose}
      />

      <div className="settings-content-body settings-form">
        <TerminalPreview prefs={global} />

        <div className="settings-form-group">
          <h3 className="settings-form-group-title">Font</h3>
          <label className="settings-field">
            <span>Family</span>
            <select value={global.fontFamily} onChange={(e) => setGlobal({ fontFamily: e.target.value })}>
              {FONT_PRESETS.map((f) => <option key={f} value={f}>{f.split(',')[0]}</option>)}
              {FONT_PRESETS.includes(global.fontFamily) ? null : (
                <option value={global.fontFamily}>{global.fontFamily.split(',')[0]}</option>
              )}
            </select>
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
            <select
              value={global.cursorStyle}
              onChange={(e) => setGlobal({ cursorStyle: e.target.value as TerminalCursorStyle })}
            >
              {CURSOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
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
          These are <strong>global</strong> defaults. Each workspace can override them in Workspace Settings.
          Colors follow the workspace theme.
        </div>
      </div>
    </section>
  )
}

function NotificationsSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled)

  const sendTest = (): void => {
    void window.oxe?.notifications?.notify({
      title: 'OXESpace',
      body: 'Test notification — agent attention alerts look like this.',
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
          Alerts only fire for terminals you are <strong>not watching</strong>.
          While you follow an agent in the focused pane, OXESpace stays quiet.
        </div>

        <button
          type="button"
          className="settings-btn ghost"
          onClick={sendTest}
          disabled={!notificationsEnabled}
          data-testid="btn-test-notification"
        >
          <Bell size={13} aria-hidden="true" />
          Send test notification
        </button>
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
  const checkRtk = useUpdaterStore((s) => s.checkRtk)
  const updateRtk = useUpdaterStore((s) => s.updateRtk)

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  // electron-updater is a no-op outside packaged installs. Treat disabled as "dev build".
  const isDevBuild = app.status === 'disabled'
  const versionLabel = app.currentVersion === 'dev' || !app.currentVersion
    ? 'dev build'
    : `v${app.currentVersion}`

  const appStatusLabel = (() => {
    switch (app.status) {
      case 'disabled':
        return 'App auto-update is off in development. Install a release build to check GitHub Releases.'
      case 'checking':
        return 'Checking GitHub Releases…'
      case 'available':
        return `Update ${app.availableVersion} available — downloading in the background`
      case 'downloading':
        return `Downloading ${app.availableVersion ?? 'update'}… ${app.progress ?? 0}%`
      case 'downloaded':
        return `Ready to install ${app.availableVersion}`
      case 'not-available':
        return 'You are on the latest release'
      case 'error':
        return app.error ?? 'Update check failed'
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
        onClose={onClose}
      />

      <div className="settings-content-body settings-form settings-updates-form">
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
            <div className="settings-progress" role="progressbar" aria-valuenow={app.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="settings-progress-bar" style={{ width: `${app.progress}%` }} />
            </div>
          ) : null}
          {app.error && app.status === 'error' ? (
            <p className="settings-error" data-testid="app-update-error">{app.error}</p>
          ) : null}
          <div className="settings-update-actions">
            <button
              type="button"
              className="settings-btn ghost"
              disabled={isDevBuild || app.status === 'checking' || app.status === 'downloading'}
              onClick={() => void checkAppUpdates()}
              data-testid="btn-check-app-updates"
              title={isDevBuild ? 'Only available in installed (packaged) builds' : 'Check GitHub Releases for a new version'}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {isDevBuild ? 'Unavailable in dev' : 'Check for updates'}
            </button>
            {app.status === 'downloaded' ? (
              <button
                type="button"
                className="settings-btn primary"
                onClick={() => void quitAndInstall()}
                data-testid="btn-install-app-update"
              >
                <Download size={13} aria-hidden="true" />
                Restart & install
              </button>
            ) : null}
          </div>
          <p className="settings-update-hint">
            {isDevBuild ? (
              <>
                You are on <code>npm run dev</code>. The app binary is not installed, so GitHub auto-update
                cannot run. Use <strong>Install RTK</strong> below for the sidecar, or install a packaged
                OXESpace release to enable app updates.
              </>
            ) : (
              <>
                Packaged installs check GitHub Releases automatically and download in the background.
                Restart applies the update.
              </>
            )}
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
            <span className={`settings-status-pill ${rtk.updateAvailable ? 'warn' : rtk.installed ? 'ok' : 'muted'}`}>
              {rtk.checking ? 'checking' : rtk.updating ? 'updating' : rtk.updateAvailable ? 'update' : rtk.installed ? 'ok' : 'missing'}
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
            <button
              type="button"
              className="settings-btn ghost"
              disabled={rtk.checking || rtk.updating}
              onClick={() => void checkRtk()}
              data-testid="btn-check-rtk"
            >
              <RefreshCw size={13} aria-hidden="true" />
              Check RTK
            </button>
            <button
              type="button"
              className="settings-btn primary"
              disabled={rtk.updating || (!rtk.updateAvailable && rtk.installed)}
              onClick={() => void updateRtk()}
              data-testid="btn-update-rtk"
            >
              <Download size={13} aria-hidden="true" />
              {rtk.installed ? 'Update RTK' : 'Install RTK'}
            </button>
          </div>
          <p className="settings-update-hint">
            RTK is a sidecar binary under userData. It works in dev and production — install or update
            without shipping a new OXESpace release.
          </p>
        </article>

        <article className="settings-update-card bundled" data-testid="settings-bundled-tools">
          <div className="settings-update-card-head">
            <span className="settings-update-icon bundled" aria-hidden="true">
              <Package size={16} />
            </span>
            <div>
              <strong>Bundled with the app</strong>
              <span>Ship with each OXESpace release</span>
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
          <p className="settings-update-hint">
            These update when you install a new OXESpace version — no separate download.
          </p>
        </article>
      </div>
    </section>
  )
}
