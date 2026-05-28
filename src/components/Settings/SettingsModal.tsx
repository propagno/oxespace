import { Bot, Mic, Plus, RefreshCw, Settings2, X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'
import type { VoiceModelSize, VoiceModelStatus } from '../../../shared/types/voice'
import { useVoiceStore } from '../../store/voice.store'

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
  const [section, setSection] = useState<'providers' | 'voice'>('providers')
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
              className={`settings-nav-item${section === 'voice' ? ' active' : ''}`}
              aria-current={section === 'voice' ? 'page' : undefined}
              onClick={() => setSection('voice')}
            >
              <Mic size={14} aria-hidden="true" />
              <span>Voice</span>
            </button>
          </nav>
        </aside>

        {section === 'voice' ? (
          <VoiceSettingsSection onClose={onClose} />
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
