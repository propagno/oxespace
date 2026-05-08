import { RefreshCw, Trash2, X } from 'lucide-react'
import { type FormEvent, type ReactElement, useState } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'
import type { UpdateAgentProfileInput } from '../../../shared/types/agent'

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
  const [name, setName] = useState(profile.name)
  const [command, setCommand] = useState(profile.command)
  const [isSubmitting, setSubmitting] = useState(false)
  const [isDeleting, setDeleting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
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
          <h2 id="agent-config-title">Configure agent</h2>
          <button type="button" className="icon-button" aria-label="Close modal" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {readiness ? (
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

          {submitError ? (
            <div className="modal-error" role="alert">{submitError}</div>
          ) : null}

          {!profile.isBuiltin ? (
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
              Save
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
