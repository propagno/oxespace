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

function validateCommandTemplate(template: string): string | null {
  if (!template.trim()) return 'Command template is required'
  if (!/\{\{task\}\}/.test(template)) return 'Template must contain {{task}}'
  return null
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
  const [commandTemplate, setCommandTemplate] = useState(profile.commandTemplate)
  const [model, setModel] = useState(profile.model ?? '')
  const [role, setRole] = useState(profile.role ?? '')
  const [isSubmitting, setSubmitting] = useState(false)
  const [isDeleting, setDeleting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)

  const handleTemplateChange = (value: string): void => {
    setCommandTemplate(value)
    setTemplateError(validateCommandTemplate(value))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const tplError = validateCommandTemplate(commandTemplate)
    if (tplError) {
      setTemplateError(tplError)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSave(profile.agentProfileId, {
        name: name.trim() || profile.name,
        command: command.trim() || profile.command,
        commandTemplate: commandTemplate.trim(),
        model: model.trim() || undefined,
        role: role.trim() || undefined
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
              disabled={profile.isBuiltin}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="claude"
              data-testid="input-agent-command"
            />
          </label>

          <label className="field">
            <span>Command template</span>
            <textarea
              value={commandTemplate}
              onChange={(e) => handleTemplateChange(e.target.value)}
              placeholder="{{task}}"
              className={templateError ? 'field-error' : undefined}
              data-testid="input-agent-template"
            />
            {templateError ? (
              <span className="field-hint error" role="alert">{templateError}</span>
            ) : (
              <span className="field-hint">Must contain <code>{'{{task}}'}</code></span>
            )}
          </label>

          <label className="field">
            <span>Model <span style={{ color: 'var(--tx-muted)', fontWeight: 400 }}>(optional)</span></span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-opus-4-7"
              data-testid="input-agent-model"
            />
          </label>

          <label className="field">
            <span>Role / system prompt <span style={{ color: 'var(--tx-muted)', fontWeight: 400 }}>(optional)</span></span>
            <textarea
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="You are a helpful software engineer..."
              data-testid="input-agent-role"
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
              disabled={isSubmitting || !!templateError}
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
