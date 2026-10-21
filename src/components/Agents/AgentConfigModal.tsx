import { RefreshCw, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactElement, useState } from 'react'
import type { AgentProfile, AgentProvider, AgentReadiness } from '../../../shared/types/agent'
import { BUILTIN_PROVIDERS, type UpdateAgentProfileInput } from '../../../shared/types/agent'
import { Button, ConfirmDialog, Dialog, IconButton, TextField, Select, TextArea } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

const PROVIDER_LABEL: Record<(typeof BUILTIN_PROVIDERS)[number], string> = {
  claude: 'Claude',
  copilot: 'Copilot',
  codex: 'Codex',
  antigravity: 'Antigravity',
  cursor: 'Cursor',
  grok: 'Grok CLI'
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
  const [confirmDelete, setConfirmDelete] = useState(false)

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
        setSubmitError(humanizeError(err, 'Failed to save agent profile'))
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
      setSubmitError(humanizeError(err, 'Failed to save agent profile'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    setDeleting(true)
    try {
      await onDelete(profile.agentProfileId)
      onClose()
    } catch (err) {
      setSubmitError(humanizeError(err, 'Failed to delete agent profile'))
      setConfirmDelete(false)
      setDeleting(false)
    }
  }

  if (confirmDelete) {
    return <ConfirmDialog title="Delete this agent profile?" description={`“${profile.name}” is removed from OXESpace. Terminals already running it keep running.`}
      confirmLabel="Delete profile" danger busy={isDeleting} onCancel={() => setConfirmDelete(false)} onConfirm={() => void handleDelete()} />
  }

  return (
    <Dialog
      title={isNew ? 'New custom agent' : 'Configure agent'}
      description={isCustom ? 'A skill prompt that runs on top of a built-in agent.' : 'The name and command OXESpace uses to start this agent.'}
      onClose={onClose}
      footer={<>
        {!profile.isBuiltin && !isNew ? (
          <Button variant="ghost" data-align="start" icon={<Trash2 size={14} aria-hidden="true" />} disabled={isDeleting} onClick={() => setConfirmDelete(true)} data-testid="btn-delete-agent">
            Delete profile
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="agent-config-form" variant="primary" loading={isSubmitting} data-testid="btn-save-agent">
          {isNew ? 'Create' : 'Save'}
        </Button>
      </>}
    >
      {readiness && !isCustom ? (
        <div className="readiness-row agent-config-readiness">
          <span className={`agent-badge ${readiness.status}`}>{readiness.status}</span>
          {readiness.details ? <span className="agent-config-readiness-detail">{readiness.details}</span> : null}
          {readiness.version ? <span className="readiness-version">{readiness.version}</span> : null}
          <IconButton className="agent-config-health" label="Run health check" size="sm" disabled={isDiscovering} onClick={onHealthCheck}
            icon={<RefreshCw size={12} aria-hidden="true" className={isDiscovering ? 'spin' : undefined} />} />
        </div>
      ) : null}

      <form id="agent-config-form" className="modal-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="field">
            <span>Name</span>
            <TextField
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
                <Select
                  value={parentProvider}
                  onChange={(e) => setParentProvider(e.target.value as AgentProvider)}
                  data-testid="select-parent-provider"
                >
                  {BUILTIN_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>{PROVIDER_LABEL[provider]}</option>
                  ))}
                </Select>
              </label>

              <label className="field">
                <span>Skill prompt</span>
                <TextArea
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
              <TextField
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

        </form>
    </Dialog>
  )
}
