import { RefreshCw, Trash2, X } from 'lucide-react'
import { type FormEvent, type ReactElement, useState } from 'react'
import type { AgentProfile, AgentProvider, AgentReadiness } from '../../../shared/types/agent'
import { BUILTIN_PROVIDERS, type UpdateAgentProfileInput } from '../../../shared/types/agent'

const PROVIDER_LABEL: Record<(typeof BUILTIN_PROVIDERS)[number], string> = {
  claude: 'Claude',
  copilot: 'Copilot',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor'
}

interface AgentConfigModalProps {
  profile: AgentProfile
  readiness: AgentReadiness | undefined
  isDiscovering: boolean
  onSave: (id: string, input: UpdateAgentProfileInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onHealthCheck: () => void
  onClose: () => void
}

export function AgentConfigModal({
  profile,
  readiness,
  isDiscovering,
  onSave,
  onDelete,
  onHealthCheck,
  onClose
}: AgentConfigModalProps): ReactElement {
  const isCustom = profile.provider === 'custom'
  const isNew = profile.agentProfileId === ''

  const [name, setName] = useState(profile.name)
  const [command, setCommand] = useState(profile.command)
  const [parentProvider, setParentProvider] = useState<AgentProvider>(profile.parentProvider ?? 'claude')
  const [systemPrompt, setSystemPrompt] = useState(profile.systemPrompt ?? '')
  const [isSubmitting, setSubmitting] = useState(false)
  const [isDeleting, setDeleting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (isCustom) {
      const trimmedPrompt = systemPrompt.trim()
      if (!trimmedPrompt) {
        setSubmitError('Skill prompt is required')
        return
      }
      setSubmitting(true)
      setSubmitError(null)
      try {
        await onSave(profile.agentProfileId, {
          name: name.trim() || profile.name,
          command: '',
          commandTemplate: '',
          parentProvider,
          systemPrompt: trimmedPrompt
        })
        onClose()
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to save agent profile')
      } finally {
        setSubmitting(false)
      }
      return
    }

    const nextCommand = command.trim()
    if (!nextCommand) {
      setSubmitError('Command is required')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSave(profile.agentProfileId, {
        name: name.trim() || profile.name,
        command: nextCommand
      })
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save agent profile')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!confirm(`Delete agent profile "${profile.name}"?`)) return
    setDeleting(true)
    try {
      await onDelete(profile.agentProfileId)
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to delete agent profile')
      setDeleting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="agent-config-title">
        <header className="modal-header">
          <h2 id="agent-config-title">{isNew ? 'New custom agent' : 'Configure agent'}</h2>
          <button type="button" className="icon-button" aria-label="Close modal" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {readiness && !isCustom ? (
          <div className="readiness-row" style={{ margin: '0 18px', marginTop: '14px' }}>
            <span className={`agent-badge ${readiness.status}`}>{readiness.status}</span>
            {readiness.details ? (
              <span style={{ fontSize: '12px', color: 'var(--tx-muted)' }}>{readiness.details}</span>
            ) : null}
            {readiness.version ? (
              <span className="readiness-version">{readiness.version}</span>
            ) : null}
            <button
              type="button"
              className="sidebar-btn"
              aria-label="Run health check"
              title="Run health check"
              disabled={isDiscovering}
              onClick={onHealthCheck}
              style={{ marginLeft: 'auto' }}
            >
              <RefreshCw size={11} aria-hidden="true" className={isDiscovering ? 'spin' : undefined} />
            </button>
          </div>
        ) : null}

        <form className="modal-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              disabled={profile.isBuiltin}
              onChange={(e) => setName(e.target.value)}
              placeholder="My agent"
              data-testid="input-agent-name"
            />
          </label>

          {isCustom ? (
            <>
              <label className="field">
                <span>Parent provider</span>
                <select
                  value={parentProvider}
                  onChange={(e) => setParentProvider(e.target.value as AgentProvider)}
                  data-testid="select-parent-provider"
                >
                  {BUILTIN_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>{PROVIDER_LABEL[provider]}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Skill prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a Java 8+ expert. Review this code for best practices, performance, and correctness."
                  rows={5}
                  data-testid="textarea-system-prompt"
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span>Command</span>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="claude"
                data-testid="input-agent-command"
              />
            </label>
          )}

          {submitError ? (
            <div className="modal-error" role="alert">{submitError}</div>
          ) : null}

          {!profile.isBuiltin && !isNew ? (
            <div className="danger-zone">
              <button
                type="button"
                className="danger-action"
                disabled={isDeleting}
                onClick={() => void handleDelete()}
                data-testid="btn-delete-agent"
              >
                <Trash2 size={12} aria-hidden="true" />
                Delete profile
              </button>
            </div>
          ) : null}

          <footer className="modal-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary-action"
              disabled={isSubmitting}
              data-testid="btn-save-agent"
            >
              {isNew ? 'Create' : 'Save'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
