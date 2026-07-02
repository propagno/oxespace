import { Bell, Bot, Mic, Plus, RefreshCw, Settings2, SquareTerminal, X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'
import type { VoiceModelSize, VoiceModelStatus } from '../../../shared/types/voice'
import { useVoiceStore } from '../../store/voice.store'
import { useSettingsStore } from '../../store/settings.store'
import { useTerminalPrefsStore, type TerminalCursorStyle } from '../../store/terminal-prefs.store'

interface SettingsModalProps {
  agentProfiles: AgentProfile[]
  agentReadiness: AgentReadiness[]
  isDiscoveringAgents: boolean
  onClose: () => void
  onDiscoverAgents: () => void
  onConfigureAgent: (profile: AgentProfile) => void
  onNewCustomAgent: () => void
}

function readinessFor(profile: AgentProfile, readiness: AgentReadiness[]): AgentReadiness | undefined {
  return readiness.find((item) => item.provider === profile.provider)
}

function ReadinessBadge({ status }: { status: AgentReadiness['status'] | undefined }): ReactElement {
  return <span className={`agent-badge ${status ?? 'unknown'}`}>{status ?? 'unknown'}</span>
}

export function SettingsModal({
  agentProfiles,
  agentReadiness,
  isDiscoveringAgents,
  onClose,
  onDiscoverAgents,
  onConfigureAgent,
  onNewCustomAgent
}: SettingsModalProps): ReactElement {
  const [section, setSection] = useState<'providers' | 'terminal' | 'voice' | 'notifications'>('providers')
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <aside className="settings-modal-nav" aria-label="Settings sections">
          <header className="settings-modal-brand">
            <span>OXESpace</span>
            <strong id="settings-title">Settings</strong>
          </header>
          <nav>
            <button
              type="button"
              className={`settings-nav-item${section === 'providers' ? ' active' : ''}`}
              aria-current={section === 'providers' ? 'page' : undefined}
              onClick={() => setSection('providers')}
            >
              <Bot size={14} aria-hidden="true" />
              <span>AI Providers</span>
            </button>
            <button
              type="button"
              className={`settings-nav-item${section === 'terminal' ? ' active' : ''}`}
              aria-current={section === 'terminal' ? 'page' : undefined}
              onClick={() => setSection('terminal')}
            >
              <SquareTerminal size={14} aria-hidden="true" />
              <span>Terminal</span>
            </button>
            <button
              type="button"
              className={`settings-nav-item${section === 'voice' ? ' active' : ''}`}
              aria-current={section === 'voice' ? 'page' : undefined}
              onClick={() => setSection('voice')}
            >
              <Mic size={14} aria-hidden="true" />
              <span>Voice</span>
            </button>
            <button
              type="button"
              className={`settings-nav-item${section === 'notifications' ? ' active' : ''}`}
              aria-current={section === 'notifications' ? 'page' : undefined}
              onClick={() => setSection('notifications')}
            >
              <Bell size={14} aria-hidden="true" />
              <span>Notifications</span>
            </button>
          </nav>
        </aside>

        {section === 'terminal' ? (
          <TerminalSettingsSection onClose={onClose} />
        ) : section === 'voice' ? (
          <VoiceSettingsSection onClose={onClose} />
        ) : section === 'notifications' ? (
          <NotificationsSettingsSection onClose={onClose} />
        ) : (
        <section className="settings-modal-content" aria-labelledby="settings-providers-title">
          <header className="settings-content-header">
            <div>
              <span>Status</span>
              <h2 id="settings-providers-title">AI Providers</h2>
            </div>
            <div className="settings-content-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="Run health check"
                title="Run health check"
                data-testid="btn-discover-agents"
                disabled={isDiscoveringAgents}
                onClick={onDiscoverAgents}
              >
                <RefreshCw size={14} aria-hidden="true" className={isDiscoveringAgents ? 'spin' : undefined} />
              </button>
              <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="settings-agent-table">
            {(() => {
              const providers = agentProfiles
              if (providers.length === 0) {
                return <p className="workspace-list-empty">No providers found. Run a health check.</p>
              }
              return providers.map((profile) => {
                const readiness = readinessFor(profile, agentReadiness)
                const isCustom = profile.provider === 'custom'
                return (
                  <article className="settings-agent-row" key={profile.agentProfileId}>
                    <div className="settings-agent-main">
                      <strong>{profile.name}</strong>
                      <span>
                        {isCustom
                          ? `custom · ${profile.parentProvider ?? '—'}`
                          : profile.command}
                      </span>
                    </div>
                    <div className="settings-agent-state">
                      {/* Custom agents have no readiness probe of their own —
                          they inherit their parent provider's status. */}
                      {!isCustom ? <ReadinessBadge status={readiness?.status} /> : null}
                      {readiness?.version && !isCustom ? <span className="readiness-version">{readiness.version}</span> : null}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Configure ${profile.name}`}
                        title="Configure"
                        onClick={() => onConfigureAgent(profile)}
                        data-testid={`btn-configure-agent-${profile.provider}`}
                      >
                        <Settings2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                )
              })
            })()}
          </div>

          <button
            type="button"
            className="settings-new-agent-btn"
            onClick={onNewCustomAgent}
            data-testid="btn-new-custom-agent"
          >
            <Plus size={13} aria-hidden="true" />
            New custom agent
          </button>
        </section>
        )}
      </section>
    </div>
  )
}

const MODEL_OPTIONS: Array<{ value: VoiceModelSize; label: string }> = [
  { value: 'tiny', label: 'Tiny — mais rápido, menos preciso (~75 MB)' },
  { value: 'base', label: 'Base — equilibrado (~142 MB)' },
  { value: 'small', label: 'Small — mais preciso, mais lento (~466 MB)' }
]

function VoiceSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const { modelSize, pttHotkey, setModelSize, setPttHotkey } = useVoiceStore()
  const [model, setModel] = useState<VoiceModelStatus | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const downloadModel = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const status = await window.oxe.voice.ensureModel(modelSize)
      setModel(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao baixar o modelo.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <section className="settings-modal-content" aria-labelledby="settings-voice-title">
      <header className="settings-content-header">
        <div>
          <span>OXEVoice</span>
          <h2 id="settings-voice-title">Voice</h2>
        </div>
        <div className="settings-content-actions">
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="settings-voice-form">
        <label className="settings-field">
          <span>Idioma</span>
          <input type="text" value="Português (Brasil)" readOnly disabled aria-label="Idioma fixo: Português do Brasil" />
        </label>

        <label className="settings-field">
          <span>Modelo</span>
          <select value={modelSize} onChange={(e) => setModelSize(e.target.value as VoiceModelSize)}>
            {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <label className="settings-field">
          <span>Atalho push-to-talk</span>
          <input
            type="text"
            value={pttHotkey}
            spellCheck={false}
            onChange={(e) => setPttHotkey(e.target.value)}
            placeholder="Ctrl+Shift+Space"
          />
        </label>

        <div className="settings-voice-model-status">
          <div>
            <strong>Motor</strong>
            <span className={model?.engineReady ? 'ok' : 'warn'}>
              {model?.engineReady ? 'disponível' : 'indisponível'}
            </span>
          </div>
          <div>
            <strong>Modelo «{modelSize}»</strong>
            <span className={model?.ready ? 'ok' : 'warn'}>
              {model?.ready ? 'pronto' : progress !== null ? `baixando… ${Math.round(progress * 100)}%` : 'não baixado'}
            </span>
          </div>
          {!model?.ready ? (
            <button type="button" className="settings-new-agent-btn" disabled={busy || !model?.engineReady} onClick={() => void downloadModel()}>
              {busy ? 'Baixando…' : 'Baixar modelo'}
            </button>
          ) : null}
          {error ? <p className="settings-voice-error">{error}</p> : null}
        </div>

        <p className="settings-voice-hint">
          O reconhecimento roda 100% local (whisper.cpp) em <strong>português do Brasil</strong> — nenhum áudio sai da sua máquina.
          Segure o atalho para falar e solte para inserir no terminal; um toque no microfone alterna o modo mãos-livres.
        </p>
      </div>
    </section>
  )
}

const CURSOR_OPTIONS: Array<{ value: TerminalCursorStyle; label: string }> = [
  { value: 'block', label: 'Bloco' },
  { value: 'bar', label: 'Barra' },
  { value: 'underline', label: 'Sublinhado' }
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

function TerminalSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const global = useTerminalPrefsStore((s) => s.global)
  const setGlobal = useTerminalPrefsStore((s) => s.setGlobal)

  return (
    <section className="settings-modal-content" aria-labelledby="settings-terminal-title">
      <header className="settings-content-header">
        <div>
          <span>Aparência</span>
          <h2 id="settings-terminal-title">Terminal</h2>
        </div>
        <div className="settings-content-actions">
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="settings-voice-form">
        <label className="settings-field">
          <span>Fonte</span>
          <select value={global.fontFamily} onChange={(e) => setGlobal({ fontFamily: e.target.value })}>
            {FONT_PRESETS.map((f) => <option key={f} value={f}>{f.split(',')[0]}</option>)}
            {FONT_PRESETS.includes(global.fontFamily) ? null : <option value={global.fontFamily}>{global.fontFamily.split(',')[0]}</option>}
          </select>
        </label>

        <label className="settings-field">
          <span>Tamanho da fonte — {global.fontSize}px <small>(Ctrl + / Ctrl − / Ctrl 0)</small></span>
          <input type="range" min={8} max={32} step={1} value={global.fontSize}
            onChange={(e) => setGlobal({ fontSize: Number(e.target.value) })} />
        </label>

        <label className="settings-field">
          <span>Altura de linha — {global.lineHeight.toFixed(1)}</span>
          <input type="range" min={1} max={2} step={0.1} value={global.lineHeight}
            onChange={(e) => setGlobal({ lineHeight: Number(e.target.value) })} />
        </label>

        <label className="settings-field">
          <span>Espaçamento entre letras — {global.letterSpacing}px</span>
          <input type="range" min={0} max={4} step={0.5} value={global.letterSpacing}
            onChange={(e) => setGlobal({ letterSpacing: Number(e.target.value) })} />
        </label>

        <label className="settings-field">
          <span>Cursor</span>
          <select value={global.cursorStyle} onChange={(e) => setGlobal({ cursorStyle: e.target.value as TerminalCursorStyle })}>
            {CURSOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <label className="settings-toggle-row">
          <span><strong>Cursor piscante</strong></span>
          <input type="checkbox" checked={global.cursorBlink} onChange={(e) => setGlobal({ cursorBlink: e.target.checked })} />
        </label>

        <label className="settings-field">
          <span>Histórico de rolagem (linhas) — {global.scrollback.toLocaleString('pt-BR')}</span>
          <input type="range" min={1000} max={200000} step={1000} value={global.scrollback}
            onChange={(e) => setGlobal({ scrollback: Number(e.target.value) })} />
        </label>

        <label className="settings-field">
          <span>Opacidade do fundo — {Math.round(global.backgroundOpacity * 100)}%{global.backgroundOpacity < 1 ? ' (translúcido)' : ''}</span>
          <input type="range" min={0.6} max={1} step={0.05} value={global.backgroundOpacity}
            onChange={(e) => setGlobal({ backgroundOpacity: Number(e.target.value) })} />
        </label>

        <p className="settings-voice-hint">
          Estas são as preferências <strong>globais</strong>. Cada workspace pode sobrescrevê-las nas
          configurações do workspace. As cores seguem o tema do workspace.
        </p>
      </div>
    </section>
  )
}

function NotificationsSettingsSection({ onClose }: { onClose: () => void }): ReactElement {
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled)

  return (
    <section className="settings-modal-content" aria-labelledby="settings-notifications-title">
      <header className="settings-content-header">
        <div>
          <span>Sistema</span>
          <h2 id="settings-notifications-title">Notifications</h2>
        </div>
        <div className="settings-content-actions">
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="settings-voice-form">
        <label className="settings-toggle-row">
          <span>
            <strong>Notificar quando um agente precisar de você</strong>
            <small>Avisa quando um agente em segundo plano termina, encerra ou dá erro. Clicar foca o terminal.</small>
          </span>
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={(e) => setNotificationsEnabled(e.target.checked)}
          />
        </label>

        <p className="settings-voice-hint">
          As notificações só disparam para terminais que você <strong>não está olhando</strong> no momento —
          enquanto você acompanha um agente, ele não te interrompe.
        </p>
      </div>
    </section>
  )
}
